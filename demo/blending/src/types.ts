export type ShapeId = 'left' | 'right'

export type ResizeEdge = 'left' | 'right' | 'top' | 'bottom'

export type ShapeState = {
  id: ShapeId
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

export type StagePoint = {
  x: number
  y: number
}

export type BlendingControls = {
  blendingDistance: number
  boundsVisible: boolean
  cornerRadius: number
  normalGatingEnabled: boolean
  blendSupportGatingEnabled: boolean
  blendSupportCellSize: number
  smoothUnionAcceleration: number
}

export type BlendingPanelValues = BlendingControls

export type InteractionState =
  | {
      mode: 'drag'
      pointerId: number
      shapeId: ShapeId
      startPoint: StagePoint
      startShape: ShapeState
    }
  | {
      mode: 'rotate'
      pointerId: number
      shapeId: ShapeId
      startAngle: number
      startShape: ShapeState
    }
  | {
      mode: 'resize'
      pointerId: number
      shapeId: ShapeId
      edge: ResizeEdge
      startPoint: StagePoint
      startShape: ShapeState
    }
