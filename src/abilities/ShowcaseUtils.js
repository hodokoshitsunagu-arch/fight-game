import { Quaternion, Vector3 } from 'three';

const UP = new Vector3(0, 1, 0);
const MID = new Vector3();
const DIR = new Vector3();
const QUATERNION = new Quaternion();

/** Position an Object3D whose unit geometry runs along local +Y between two points. */
export function setSegment(object, start, end, radius) {
  DIR.copy(end).sub(start);
  const length = Math.max(0.001, DIR.length());
  MID.copy(start).add(end).multiplyScalar(0.5);
  QUATERNION.setFromUnitVectors(UP, DIR.multiplyScalar(1 / length));
  object.position.copy(MID);
  object.quaternion.copy(QUATERNION);
  object.scale.set(radius, length, radius);
  object.updateMatrix();
  return object.matrix;
}

export function headingOf(direction) {
  return Math.atan2(direction.x, direction.z);
}
