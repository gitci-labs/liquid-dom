// Used by the two-pass separable blur pipeline to build the blurred backdrop
// that glass refraction, reflection, and metrics sampling read from.
export const BLUR_SHADER = /* wgsl */ `
struct BlurParams {
  direction: vec2f,
  radius: f32,
  _padding: f32,
};

@group(0) @binding(0) var blurSampler: sampler;
@group(0) @binding(1) var inputTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> blurParams: BlurParams;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

fn gaussianWeight(index: f32, sigma: f32) -> f32 {
  return exp(-0.5 * index * index / max(sigma * sigma, 0.0001));
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let textureSize = vec2f(textureDimensions(inputTexture));
  let blurStep = blurParams.direction / max(textureSize, vec2f(1.0)) * (blurParams.radius / 4.0);
  let sigma = 2.0;
  let clampedUv = clamp(in.uv, vec2f(0.0), vec2f(1.0));

  var color = vec3f(0.0);
  var totalWeight = 0.0;

  for (var i = -4; i <= 4; i = i + 1) {
    let index = f32(i);
    let weight = gaussianWeight(index, sigma);
    let sampleUv = clamp(clampedUv + blurStep * index, vec2f(0.0), vec2f(1.0));
    color = color + textureSampleLevel(inputTexture, blurSampler, sampleUv, 0.0).rgb * weight;
    totalWeight = totalWeight + weight;
  }

  return vec4f(color / max(totalWeight, 0.0001), 1.0);
}
`

// Shared SDF, profile, and fullscreen-triangle helpers used by the glass and
// metrics passes so both evaluate the same fused shape field.
const SHADER_SHARED = /* wgsl */ `
struct Globals {
  canvas: vec4f,
  shape: vec4f,
  glass: vec4f,
  content: vec4f,
  lighting: vec4f,
  specular: vec4f,
  specularSecondary: vec4f,
  tint: vec4f,
};

struct ShapeData {
  inverse0: vec4f,
  inverse1: vec4f,
  geometry: vec4f,
  contentRange: vec4f,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = clamp(0.5 + 0.5 * (b - a) / max(k, 0.0001), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn squircleLength(v: vec2f) -> f32 {
  let a = abs(v);
  return pow(pow(a.x, 4.0) + pow(a.y, 4.0), 0.25);
}

fn circularLength(v: vec2f) -> f32 {
  return length(v);
}

fn sdRoundRect(localPos: vec2f, halfSize: vec2f, radius: f32, cornerTransitionSpeed: f32) -> f32 {
  let cornerLimit = min(halfSize.x, halfSize.y);
  let clampedRadius = min(radius, cornerLimit);
  let blendDistance = max(cornerTransitionSpeed, 0.0001);
  let circleBlend = clamp((radius - cornerLimit) / blendDistance, 0.0, 1.0);
  let q = abs(localPos) - halfSize + vec2f(clampedRadius);
  let cornerDistance = mix(
    squircleLength(max(q, vec2f(0.0))),
    circularLength(max(q, vec2f(0.0))),
    circleBlend,
  );
  return cornerDistance + min(max(q.x, q.y), 0.0) - clampedRadius;
}

fn shapeLocalPos(shape: ShapeData, pos: vec2f) -> vec2f {
  return vec2f(
    shape.inverse0.x * pos.x + shape.inverse0.y * pos.y + shape.inverse0.z,
    shape.inverse1.x * pos.x + shape.inverse1.y * pos.y + shape.inverse1.z,
  );
}

fn shapeDistanceFromLocal(shape: ShapeData, localPos: vec2f) -> f32 {
  let halfSize = shape.geometry.xy;
  let localDistance = sdRoundRect(
    localPos - halfSize,
    halfSize,
    shape.inverse1.w,
    shape.geometry.z,
  );
  return localDistance * shape.inverse0.w;
}

fn shapeDistance(shape: ShapeData, pos: vec2f) -> f32 {
  return shapeDistanceFromLocal(shape, shapeLocalPos(shape, pos));
}

fn sceneSdf(pos: vec2f, shapeCount: u32, smoothing: f32) -> f32 {
  var distance = 1e5;
  var found = false;

  for (var i = 0u; i < shapeCount; i = i + 1u) {
    let shape = shapes[i];
    let nextDistance = shapeDistance(shape, pos);
    if (!found) {
      distance = nextDistance;
      found = true;
    } else {
      distance = smin(distance, nextDistance, smoothing);
    }
  }

  return distance;
}

fn sdfGradient(pos: vec2f, shapeCount: u32, smoothing: f32) -> vec2f {
  let eps = 1.0;
  let gradient = vec2f(
    sceneSdf(pos + vec2f(eps, 0.0), shapeCount, smoothing) - sceneSdf(pos - vec2f(eps, 0.0), shapeCount, smoothing),
    sceneSdf(pos + vec2f(0.0, eps), shapeCount, smoothing) - sceneSdf(pos - vec2f(0.0, eps), shapeCount, smoothing),
  );
  let magnitude = length(gradient);
  if (magnitude < 0.0001) {
    return vec2f(0.0, -1.0);
  }
  return gradient / magnitude;
}

fn smootherstep(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn smootherstepDerivative(value: f32) -> f32 {
  let x = clamp(value, 0.0, 1.0);
  return 30.0 * x * x * (x * (x - 2.0) + 1.0);
}

fn convexSquircle(x: f32) -> vec2f {
  let u = 1.0 - clamp(x, 0.0, 1.0);
  let inside = max(1.0 - pow(u, 4.0), 0.0001);
  let height = sqrt(inside);
  let derivative = 2.0 * pow(u, 3.0) / sqrt(inside);
  return vec2f(height, derivative);
}

fn concaveCircle(x: f32) -> vec2f {
  let squircle = convexSquircle(x);
  return vec2f(1.0 - squircle.x, -squircle.y);
}

fn evaluateHeightProfile(profileIndex: f32, x: f32) -> vec2f {
  if (profileIndex < 0.5) {
    return convexSquircle(x);
  }

  if (profileIndex < 1.5) {
    return concaveCircle(x);
  }

  let convex = convexSquircle(x);
  let concave = concaveCircle(x);
  let blend = smootherstep(x);
  let blendDerivative = smootherstepDerivative(x);
  let height = mix(convex.x, concave.x, blend);
  let derivative = mix(convex.y, concave.y, blend) + (concave.x - convex.x) * blendDerivative;
  return vec2f(height, derivative);
}

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}
`

// Used by the main glass render pass. This shades the fused glass containers,
// sampling the sharp and blurred backdrop textures for refraction, reflection, and highlights.
export const GLASS_SHADER = /* wgsl */ `
${SHADER_SHARED}

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> shapes: array<ShapeData>;
@group(0) @binding(2) var backgroundSampler: sampler;
@group(0) @binding(3) var backgroundTextureSharp: texture_2d<f32>;
@group(0) @binding(4) var backgroundTextureBlurred: texture_2d<f32>;
@group(0) @binding(5) var glassContentTexture: texture_2d<f32>;

struct ContentData {
  inverse0: vec4f,
  inverse1: vec4f,
  atlasRect: vec4f,
};

@group(0) @binding(6) var<storage, read> contentEntries: array<ContentData>;

fn sampleBackgroundSharp(uv: vec2f) -> vec3f {
  return textureSampleLevel(backgroundTextureSharp, backgroundSampler, uv, 0.0).rgb;
}

fn sampleBackgroundBlurred(uv: vec2f) -> vec3f {
  return textureSampleLevel(backgroundTextureBlurred, backgroundSampler, uv, 0.0).rgb;
}

fn contentLocalPos(content: ContentData, glassLocalPos: vec2f) -> vec2f {
  return vec2f(
    content.inverse0.x * glassLocalPos.x + content.inverse0.y * glassLocalPos.y + content.inverse0.z,
    content.inverse1.x * glassLocalPos.x + content.inverse1.y * glassLocalPos.y + content.inverse1.z,
  );
}

fn sampleGlassContentAtlas(content: ContentData, localPos: vec2f) -> vec4f {
  let copiedSize = vec2f(content.inverse0.w, content.inverse1.w);
  if (
    any(copiedSize <= vec2f(0.0)) ||
    any(content.atlasRect.zw <= vec2f(0.0)) ||
    any(localPos < vec2f(0.0)) ||
    any(localPos > copiedSize)
  ) {
    return vec4f(0.0);
  }

  let atlasUv = content.atlasRect.xy + localPos * content.atlasRect.zw;
  return textureSampleLevel(glassContentTexture, backgroundSampler, atlasUv, 0.0);
}

fn sampleGlassContentEntry(
  content: ContentData,
  glassLocalRed: vec2f,
  glassLocalGreen: vec2f,
  glassLocalBlue: vec2f,
  contentMask: f32,
) -> vec4f {
  if (contentMask <= 0.0) {
    return vec4f(0.0);
  }

  let contentRed = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalRed));
  let contentGreen = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalGreen));
  let contentBlue = sampleGlassContentAtlas(content, contentLocalPos(content, glassLocalBlue));
  let alpha = max(contentGreen.a, max(contentRed.a, contentBlue.a)) * contentMask;
  return vec4f(vec3f(contentRed.r, contentGreen.g, contentBlue.b), alpha);
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let shapeCount = u32(globals.shape.z);
  let fragCoord = in.uv * globals.canvas.xy;
  let background = sampleBackgroundSharp(in.uv);

  let distance = sceneSdf(fragCoord, shapeCount, globals.shape.x);
  let fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  let gradient = sdfGradient(fragCoord, shapeCount, globals.shape.x);
  let pixelWidth = max(fwidth(distance), 0.75);
  let rimWidth = max(globals.specular.y, 0.0001);
  let rimBandMask =
    (1.0 - smoothstep(0.0, pixelWidth, distance)) *
    (1.0 - smoothstep(rimWidth, rimWidth + pixelWidth, -distance));
  let rimNormal = gradient;
  let lightDir = normalize(
    select(vec2f(1.0, 0.0), globals.lighting.xy, dot(globals.lighting.xy, globals.lighting.xy) > 0.0001),
  );
  let mirroredLightDir = -lightDir;

  let bezelWidth = max(globals.shape.y, pixelWidth * 2.0);
  let inwardDistance = max(-distance, 0.0);
  let bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  let profileResult = evaluateHeightProfile(globals.shape.w, bezelProgress);
  let profileHeight = profileResult.x * bezelWidth;
  let flatHeight = evaluateHeightProfile(globals.shape.w, 1.0).x * bezelWidth;
  let surfaceHeight = globals.glass.x + select(profileHeight, flatHeight, inwardDistance > bezelWidth);
  let surfaceDerivative = select(profileResult.y, 0.0, inwardDistance > bezelWidth);
  let clampedSlope = min(surfaceDerivative, tan(1.4835298));

  // Build a beveled surface normal from the SDF gradient plus the chosen height profile,
  // then refract the view ray per channel to get the displaced background lookup.
  let surfaceNormal = normalize(vec3f(gradient * clampedSlope, 1.0));
  let dispersion = max(globals.glass.w, 0.0);
  let baseIor = max(globals.glass.z, 1.0001);
  let refractedRayRed = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(baseIor + dispersion, 1.0001),
  );
  let refractedRayGreen = refract(vec3f(0.0, 0.0, -1.0), surfaceNormal, 1.0 / baseIor);
  let refractedRayBlue = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(baseIor - dispersion, 1.0001),
  );
  let displacementPxRed = select(
    refractedRayRed.xy / max(-refractedRayRed.z, 0.0001) * surfaceHeight * globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let displacementPxGreen = select(
    refractedRayGreen.xy / max(-refractedRayGreen.z, 0.0001) * surfaceHeight * globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let displacementPxBlue = select(
    refractedRayBlue.xy / max(-refractedRayBlue.z, 0.0001) * surfaceHeight * globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let contentBaseIor = max(globals.content.x, 1.0001);
  let contentRefractedRayRed = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(contentBaseIor + dispersion, 1.0001),
  );
  let contentRefractedRayGreen = refract(vec3f(0.0, 0.0, -1.0), surfaceNormal, 1.0 / contentBaseIor);
  let contentRefractedRayBlue = refract(
    vec3f(0.0, 0.0, -1.0),
    surfaceNormal,
    1.0 / max(contentBaseIor - dispersion, 1.0001),
  );
  let contentDisplacementPxRed = select(
    contentRefractedRayRed.xy /
      max(-contentRefractedRayRed.z, 0.0001) *
      globals.content.y *
      globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let contentDisplacementPxGreen = select(
    contentRefractedRayGreen.xy /
      max(-contentRefractedRayGreen.z, 0.0001) *
      globals.content.y *
      globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let contentDisplacementPxBlue = select(
    contentRefractedRayBlue.xy /
      max(-contentRefractedRayBlue.z, 0.0001) *
      globals.content.y *
      globals.glass.y,
    vec2f(0.0),
    fillMask <= 0.0,
  );
  let refractedUvRed = in.uv + displacementPxRed / globals.canvas.xy;
  let refractedUvGreen = in.uv + displacementPxGreen / globals.canvas.xy;
  let refractedUvBlue = in.uv + displacementPxBlue / globals.canvas.xy;
  let refractedColor = vec3f(
    sampleBackgroundBlurred(refractedUvRed).r,
    sampleBackgroundBlurred(refractedUvGreen).g,
    sampleBackgroundBlurred(refractedUvBlue).b,
  );
  let reflectedUv = in.uv + rimNormal * globals.specularSecondary.z / globals.canvas.xy;
  let reflectedColor = sampleBackgroundBlurred(reflectedUv);
  let glass = mix(refractedColor, globals.tint.rgb, globals.tint.a);
  let refractedLuma = dot(refractedColor, vec3f(0.2126, 0.7152, 0.0722));
  let reflectedLuma = dot(reflectedColor, vec3f(0.2126, 0.7152, 0.0722));

  // Reflection only shows when the reflected sample is bright enough and the refracted sample
  // underneath is dark enough to accept it.
  let reflectionPresence = smoothstep(0.2, 0.85, reflectedLuma);
  let refractionAcceptance = 1.0 - smoothstep(0.35, 0.85, refractedLuma);
  let reflectionBlend = reflectionPresence * refractionAcceptance;
  let edgeSpecularColor = mix(refractedColor, reflectedColor, reflectionBlend);

  // Content rendered into per-glass canvas children is sampled from its own sharp atlas,
  // refracted with the same displacement field, and then layered over the tinted backdrop
  // before any specular contributions are applied.
  var glassInterior = glass;
  for (var i = 0u; i < shapeCount; i = i + 1u) {
    let shape = shapes[i];
    let contentStart = u32(shape.contentRange.x);
    let contentCount = u32(shape.contentRange.y);
    let shapeDistanceAtFrag = shapeDistance(shape, fragCoord);
    let contentBand = max(globals.shape.x, pixelWidth);
    let contentMask = 1.0 - smoothstep(contentBand, contentBand + pixelWidth, shapeDistanceAtFrag);
    let glassLocalRed = shapeLocalPos(shape, fragCoord + contentDisplacementPxRed);
    let glassLocalGreen = shapeLocalPos(shape, fragCoord + contentDisplacementPxGreen);
    let glassLocalBlue = shapeLocalPos(shape, fragCoord + contentDisplacementPxBlue);

    for (var contentOffset = 0u; contentOffset < contentCount; contentOffset = contentOffset + 1u) {
      let contentLayer = sampleGlassContentEntry(
        contentEntries[contentStart + contentOffset],
        glassLocalRed,
        glassLocalGreen,
        glassLocalBlue,
        contentMask,
      );
      glassInterior = mix(glassInterior, contentLayer.rgb, contentLayer.a);
    }
  }

  // White specular is a separate rim-only highlight driven by 2D normal/light alignment and
  // then masked back to the configured rim band.
  let primaryBandProgress = clamp(inwardDistance / max(globals.specular.y, pixelWidth), 0.0, 1.0);
  let oppositeBandProgress = primaryBandProgress;
  let primaryStrength = globals.specular.x - globals.specularSecondary.y * primaryBandProgress * primaryBandProgress;
  let oppositeStrength =
    globals.specularSecondary.x - globals.specularSecondary.y * oppositeBandProgress * oppositeBandProgress;
  let oppositeRimBandMask = 1.0 - smoothstep(
    globals.specular.y,
    globals.specular.y + pixelWidth,
    inwardDistance,
  );
  let rimSpecular = pow(max(dot(rimNormal, lightDir), 0.0), globals.specular.z);
  let mirroredRimSpecular = pow(max(dot(rimNormal, mirroredLightDir), 0.0), globals.specular.z);
  let primarySpecularOpacity = clamp(rimSpecular * primaryStrength, 0.0, 1.0);
  let oppositeSpecularOpacity = clamp(mirroredRimSpecular * oppositeStrength, 0.0, 1.0);
  let combinedRimSpecularOpacity = clamp(
    primarySpecularOpacity * rimBandMask + oppositeSpecularOpacity * oppositeRimBandMask,
    0.0,
    1.0,
  );
  let whiteSpecularOpacity = combinedRimSpecularOpacity * globals.specular.w;
  let coloredEdgeOpacity = combinedRimSpecularOpacity;
  let whiteSpecular = vec3f(1.0) * whiteSpecularOpacity;

  var color = background;
  if (fillMask > 0.0) {
    color = mix(color, glassInterior, fillMask);
    color = mix(color, edgeSpecularColor, coloredEdgeOpacity);
    color = color + whiteSpecular;
  }

  return vec4f(color, 1.0);
}
`

// Used by the offscreen metrics pass. This samples the blurred backdrop over the
// interior of a container so the renderer can expose backdrop luminance/color statistics.
export const METRICS_SHADER = /* wgsl */ `
${SHADER_SHARED}

struct MetricsBounds {
  min: vec2f,
  max: vec2f,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> shapes: array<ShapeData>;
@group(0) @binding(2) var metricsSampler: sampler;
@group(0) @binding(3) var blurredBackdrop: texture_2d<f32>;
@group(0) @binding(4) var<uniform> metricsBounds: MetricsBounds;

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let shapeCount = u32(globals.shape.z);
  let positionPx = mix(metricsBounds.min, metricsBounds.max, in.uv);
  let insideCanvas =
    all(positionPx >= vec2f(0.0)) &&
    all(positionPx <= globals.canvas.xy);
  let distance = sceneSdf(positionPx, shapeCount, globals.shape.x);
  // This uses bezel width as the interior cutoff. For heavily fused shapes with
  // spacing wider than the bezel, the transition band can extend past this threshold,
  // but we accept that simplification for now because it does not occur in our target use cases.
  let isInterior = insideCanvas && distance <= -globals.shape.y;
  let color = textureSampleLevel(blurredBackdrop, metricsSampler, positionPx / globals.canvas.xy, 0.0).rgb;
  return vec4f(color, select(0.0, 1.0, isInterior));
}
`

// Composites one DOM-backed Html texture into the scene using the node's world transform.
export const HTML_COMPOSITE_SHADER = /* wgsl */ `
struct HtmlCompositeParams {
  canvas: vec4f,
  inverse0: vec4f,
  inverse1: vec4f,
};

@group(0) @binding(0) var compositeSampler: sampler;
@group(0) @binding(1) var sceneTexture: texture_2d<f32>;
@group(0) @binding(2) var htmlTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: HtmlCompositeParams;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(-1.0, 1.0),
    vec2f(3.0, 1.0),
  );

  let position = positions[vertexIndex];
  var output: VertexOutput;
  output.position = vec4f(position, 0.0, 1.0);
  output.uv = vec2f(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
  return output;
}

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let sceneColor = textureSampleLevel(sceneTexture, compositeSampler, in.uv, 0.0);
  let fragCoord = in.uv * params.canvas.xy;
  let localPos = vec2f(
    params.inverse0.x * fragCoord.x + params.inverse0.y * fragCoord.y + params.inverse0.z,
    params.inverse1.x * fragCoord.x + params.inverse1.y * fragCoord.y + params.inverse1.z,
  );
  let copiedSize = vec2f(params.inverse0.w, params.inverse1.w);

  if (
    any(params.canvas.zw <= vec2f(0.0)) ||
    any(copiedSize <= vec2f(0.0)) ||
    any(localPos < vec2f(0.0)) ||
    any(localPos > copiedSize)
  ) {
    return sceneColor;
  }

  let htmlColor = textureSampleLevel(htmlTexture, compositeSampler, localPos * params.canvas.zw, 0.0);
  return vec4f(mix(sceneColor.rgb, htmlColor.rgb, htmlColor.a), 1.0);
}
`
