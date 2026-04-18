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

export const GLASS_SHADER = /* wgsl */ `
struct Globals {
  canvas: vec4f,
  surface: vec4f,
  glass: vec4f,
  lighting: vec4f,
  specularPrimary: vec4f,
  specularSecondary: vec4f,
  tint: vec4f,
  profile: vec4f,
};

struct ShapeData {
  inverse0: vec4f,
  inverse1: vec4f,
  bounds: vec4f,
  shapeInfo: vec4f,
};

@group(0) @binding(0) var<uniform> globals: Globals;
@group(0) @binding(1) var<storage, read> shapes: array<ShapeData>;
@group(0) @binding(2) var backgroundSampler: sampler;
@group(0) @binding(3) var backgroundTextureSharp: texture_2d<f32>;
@group(0) @binding(4) var backgroundTextureBlurred: texture_2d<f32>;

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

fn sceneSdf(pos: vec2f) -> f32 {
  let shapeCount = u32(globals.specularSecondary.w);
  var distance = 1e5;
  var found = false;

  for (var i = 0u; i < shapeCount; i = i + 1u) {
    let shape = shapes[i];
    let localPos = vec2f(
      shape.inverse0.x * pos.x + shape.inverse0.y * pos.y + shape.inverse0.z,
      shape.inverse1.x * pos.x + shape.inverse1.y * pos.y + shape.inverse1.z,
    );
    let localDistance = sdRoundRect(
      localPos - shape.bounds.xy,
      shape.bounds.zw,
      shape.inverse1.w,
      shape.shapeInfo.x,
    );
    let shapeDistance = localDistance * shape.inverse0.w;
    if (!found) {
      distance = shapeDistance;
      found = true;
    } else {
      distance = smin(distance, shapeDistance, globals.surface.x);
    }
  }

  return distance;
}

fn sdfGradient(pos: vec2f) -> vec2f {
  let eps = 1.0;
  let gradient = vec2f(
    sceneSdf(pos + vec2f(eps, 0.0)) - sceneSdf(pos - vec2f(eps, 0.0)),
    sceneSdf(pos + vec2f(0.0, eps)) - sceneSdf(pos - vec2f(0.0, eps)),
  );
  let magnitude = length(gradient);
  if (magnitude < 0.0001) {
    return vec2f(0.0, -1.0);
  }
  return gradient / magnitude;
}

fn sampleBackgroundSharp(uv: vec2f) -> vec3f {
  return textureSampleLevel(backgroundTextureSharp, backgroundSampler, uv, 0.0).rgb;
}

fn sampleBackgroundBlurred(uv: vec2f) -> vec3f {
  return textureSampleLevel(backgroundTextureBlurred, backgroundSampler, uv, 0.0).rgb;
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

@fragment
fn fragmentMain(in: VertexOutput) -> @location(0) vec4f {
  let fragCoord = in.uv * globals.canvas.xy;
  let background = sampleBackgroundSharp(in.uv);

  let distance = sceneSdf(fragCoord);
  let fillMask = 1.0 - smoothstep(0.0, 1.4, distance);
  let gradient = sdfGradient(fragCoord);
  let pixelWidth = max(fwidth(distance), 0.75);
  let rimWidth = max(globals.specularPrimary.y, 0.0001);
  let rimBandMask =
    (1.0 - smoothstep(0.0, pixelWidth, distance)) *
    (1.0 - smoothstep(rimWidth, rimWidth + pixelWidth, -distance));
  let rimNormal = gradient;
  let lightDir = normalize(
    select(vec2f(1.0, 0.0), globals.lighting.xy, dot(globals.lighting.xy, globals.lighting.xy) > 0.0001),
  );
  let mirroredLightDir = -lightDir;

  let bezelWidth = max(globals.surface.w, pixelWidth * 2.0);
  let inwardDistance = max(-distance, 0.0);
  let bezelProgress = clamp(inwardDistance / bezelWidth, 0.0, 1.0);
  let profileResult = evaluateHeightProfile(globals.profile.x, bezelProgress);
  let profileHeight = profileResult.x * bezelWidth;
  let flatHeight = evaluateHeightProfile(globals.profile.x, 1.0).x * bezelWidth;
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
  let refractedUvRed = in.uv + displacementPxRed / globals.canvas.xy;
  let refractedUvGreen = in.uv + displacementPxGreen / globals.canvas.xy;
  let refractedUvBlue = in.uv + displacementPxBlue / globals.canvas.xy;
  let refractedColor = vec3f(
    sampleBackgroundBlurred(refractedUvRed).r,
    sampleBackgroundBlurred(refractedUvGreen).g,
    sampleBackgroundBlurred(refractedUvBlue).b,
  );

  // The colored edge component starts from the refracted blur and can be overdriven via
  // saturation. A second sample is taken farther out along the rim normal to fake reflection.
  let reflectedUv = in.uv + rimNormal * globals.specularSecondary.y / globals.canvas.xy;
  let reflectedColor = sampleBackgroundBlurred(reflectedUv);
  let glass = mix(refractedColor, globals.tint.rgb, globals.tint.a);
  let refractedLuma = dot(refractedColor, vec3f(0.2126, 0.7152, 0.0722));
  let reflectedLuma = dot(reflectedColor, vec3f(0.2126, 0.7152, 0.0722));
  let refractedBase = vec3f(refractedLuma);
  let reflectedBase = vec3f(reflectedLuma);
  let refractedEdgeColor = mix(refractedBase, refractedColor, 1.0 + globals.specularSecondary.x);
  let reflectedEdgeColor = mix(reflectedBase, reflectedColor, 1.0 + globals.specularSecondary.z);

  // Reflection only shows when the reflected sample is bright enough and the refracted sample
  // underneath is dark enough to accept it.
  let reflectionPresence = smoothstep(0.2, 0.85, reflectedLuma);
  let refractionAcceptance = 1.0 - smoothstep(0.35, 0.85, refractedLuma);
  let reflectionBlend = reflectionPresence * refractionAcceptance;
  let edgeSpecularColor = mix(refractedEdgeColor, reflectedEdgeColor, reflectionBlend);

  // White specular is a separate rim-only highlight driven by 2D normal/light alignment and
  // then masked back to the configured rim band.
  let rimSpecular = pow(max(dot(rimNormal, lightDir), 0.0), globals.specularPrimary.z);
  let mirroredRimSpecular = pow(max(dot(rimNormal, mirroredLightDir), 0.0), globals.specularPrimary.z);
  let specularOpacity = clamp((rimSpecular + mirroredRimSpecular) * globals.specularPrimary.x, 0.0, 1.0);
  let whiteSpecularOpacity = specularOpacity * globals.specularPrimary.w;
  let coloredEdgeOpacity = specularOpacity * rimBandMask;
  let whiteSpecular = vec3f(1.0) * whiteSpecularOpacity * rimBandMask;

  var color = background;
  if (fillMask > 0.0) {
    color = mix(color, glass, fillMask);
    color = mix(color, edgeSpecularColor, coloredEdgeOpacity);
    color = color + whiteSpecular;
  }

  return vec4f(color, 1.0);
}
`

export const PRESENT_SHADER = /* wgsl */ `
@group(0) @binding(0) var presentSampler: sampler;
@group(0) @binding(1) var presentTexture: texture_2d<f32>;

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
  return textureSampleLevel(presentTexture, presentSampler, in.uv, 0.0);
}
`
