# Hypothetical Design: Transparent Noop Nodes

This document describes a possible future design for transparent `noop` layout
nodes. This feature does not exist today and this document is not an
implementation plan currently in progress.

## Problem

`noop` nodes are currently used by higher-level libraries as layout-neutral
wrappers. For example, a scene graph node may need to contribute a transform,
glass container, or glass object without introducing its own layout behavior.

The current behavior is counter-intuitive:

- `noop` nodes pass measurement and placement through to one child.
- Because of that pass-through model, noop-backed wrappers are forced to accept
  exactly one child.
- Multiple children require an explicit `HStack`, `VStack`, or `ZStack` even
  when the wrapper itself is conceptually layout-neutral.

What we want instead:

```txt
HStack
  Noop
    A
    B
  C
```

The parent `HStack` should lay out `A`, `B`, and `C` as direct effective
children, while the layout tree still keeps `A` and `B` under the `Noop`.

## Core Idea

A `noop` should become a transparent projection node:

- It has no measurement behavior.
- It has no placement behavior.
- It cannot be the layout root.
- It is flattened into its nearest real layout parent.
- It still receives a layout rect derived from the union of its effective
  descendants so wrappers can use that rect for transforms or scene graph state.

In other words, `noop` remains part of the layout tree, but not part of the
parent's layout child list.

## Child Projection

When a real layout node asks for its children, the engine should return
projected effective children.

Example:

```txt
HStack
  A: noop
    B: noop
      X
      Y
    Z
  W
```

The `HStack` sees:

```txt
X, Y, Z, W
```

Each effective child carries its transparent ancestor path:

```txt
X -> [A, B]
Y -> [A, B]
Z -> [A]
W -> []
```

The path is ordered outermost to innermost.

## Measurement

Transparent noops should never be measured directly.

Parent layouts measure the projected effective children instead:

```txt
HStack.measure([X, Y, Z, W])
```

If code tries to measure a noop directly, that is a bug and should throw.

This also means a transparent noop cannot be assigned as `engine.root`, because
there is no parent that can project its children.

## Placement

Placement needs two phases.

### Phase 1: Record Effective Child Placements

When the parent layout places projected children, each effective child records
the requested placement instead of immediately calling `placeNode`.

```ts
type PlacementRecord = {
  node: Layout
  transparentPath: Layout[]
  bounds: Rect
  proposal: ProposedSize
}
```

The `bounds` are in the parent's local coordinate space.

### Phase 2: Resolve Transparent Ancestor Bounds

After the parent has placed all projected children, the engine computes a union
for each transparent ancestor.

Using the earlier example, if the `HStack` places:

```txt
X = { x: 0,   y: 0, width: 50, height: 40 }
Y = { x: 60,  y: 0, width: 50, height: 40 }
Z = { x: 120, y: 0, width: 50, height: 40 }
W = { x: 180, y: 0, width: 50, height: 40 }
```

Then:

```txt
A absolute bounds = union(X, Y, Z)
                  = { x: 0, y: 0, width: 170, height: 40 }

B absolute bounds = union(X, Y)
                  = { x: 0, y: 0, width: 110, height: 40 }
```

The engine then writes layout rects in parent-local coordinates:

```txt
A rect, local to HStack:
{ x: 0, y: 0, width: 170, height: 40 }

B rect, local to A:
{ x: 0, y: 0, width: 110, height: 40 }

X rect, local to B:
{ x: 0, y: 0, width: 50, height: 40 }

Y rect, local to B:
{ x: 60, y: 0, width: 50, height: 40 }

Z rect, local to A:
{ x: 120, y: 0, width: 50, height: 40 }

W rect, local to HStack:
{ x: 180, y: 0, width: 50, height: 40 }
```

This rebasing is the reason placement cannot be done one child at a time. A
later child can expand a transparent ancestor's union and change the local
coordinate system for earlier children.

## Parent Child Models

Flattening must respect the parent layout's child model.

### Sequence Parents

Layouts like `HStack`, `VStack`, `ZStack`, and custom sequence-like layouts can
accept any number of projected effective children.

```txt
HStack
  noop
    A
    B
  C
```

Effective children:

```txt
A, B, C
```

### Single-Child Parents

Layouts like `Frame` and `Padding` should validate after projection.

```txt
Frame
  noop
    A
    B
```

This should throw because the `Frame` effectively has two children. Users should
wrap the subtree in an explicit layout node:

```txt
Frame
  ZStack
    A
    B
```

### Fixed-Slot Parents

`Background` and `Overlay` have slot semantics. Their children are not a normal
sequence.

Flattening should happen within each slot, not across slots. If a slot projects
to more than one effective child, that slot should throw and require an explicit
layout wrapper.

Also, empty decoration/content placeholders should not be transparent noops.
They should use a dedicated non-transparent empty node that measures zero.

## Caching

Transparent noops should not have measurement cache entries, because they are
never measured.

Effective descendants continue to use the normal `measureNode(child, proposal)`
path and therefore keep their existing cache behavior.

The parent measurement cache key should include a projected child signature,
because the parent's real measurement input is now its projected effective
children, not only its direct layout children.

A projected child signature could include:

```txt
effectiveChildId:transparentAncestorIds:isSpacer
```

Example:

```txt
X:A/B:false
Y:A/B:false
Z:A:false
W::false
```

The existing subtree revision propagation will invalidate many cases already,
but encoding the projected child list in the key makes the cache model explicit
and easier to reason about.

Placement should not be cached. It writes fresh layout rects to both effective
children and transparent ancestors every layout pass.

## Expected Integration With Higher-Level UI Wrappers

If implemented, higher-level noop-backed wrappers could accept multiple
children:

- transform wrappers
- glass containers
- glass nodes
- other layout-neutral scene graph wrappers

The wrapper would keep its scene hierarchy, but its children would
participate directly in the nearest real layout parent.

Single-child restrictions would remain on nodes whose layout semantics are
actually single-child, such as `Frame` and `Padding`.

## Non-Goals

- Do not make `noop` behave like `ZStack`.
- Do not allow `noop` as the root.
- Do not give `noop` fallback measurement or placement behavior.
- Do not implement transparency in React or another wrapper layer only; the
  layout engine should own this behavior.
