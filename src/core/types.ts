export interface Rational {
  numerator: string;
  denominator: string;
}

export interface ButterflyPair {
  layer: number;
  span: number;
  lowIndex: number;
  highIndex: number;
  oldU: string;
  oldV: string;
  newU: string;
  newV: string;
}

export interface ButterflyLayerView {
  layer: number;
  span: number;
  before: string[];
  after: string[];
  pairs: ButterflyPair[];
}

export interface TransformResult {
  coefficients: Rational[];
  layers: ButterflyLayerView[];
  order: 'NATURAL_BINARY';
  scaling: 'UNNORMALIZED_FORWARD';
  bitWidth: number;
  algorithmVersion: 'fwht-natural-butterfly/v1';
}

export interface Contribution {
  i: number;
  j: number;
  iMask: string;
  jMask: string;
  a: string;
  b: string;
  product: string;
}

export interface ConvolutionResult {
  coefficients: Rational[];
  contributions: Contribution[];
  queriedIndex: number;
  order: 'NATURAL_BINARY';
  scaling: 'FORWARD_POINTWISE_INVERSE';
  bitWidth: number;
  algorithmVersion: 'fwht-natural-butterfly/v1';
}
