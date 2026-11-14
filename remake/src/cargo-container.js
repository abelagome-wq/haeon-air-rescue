// Small aluminium sling container with a permanent four-leg lifting bridle.
// The model origin is the middle of its footprint, at the bottom of the skids.
export const CARGO_EYE_HEIGHT = 2.55;
export const CARGO_LENGTH = 2.9;
export const CARGO_WIDTH = 1.65;

export function cargoContainerGeometry(T) {
  const vertices = [], colors = [], indices = [];
  const color = new T.Color();
  const v = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const box = new T.BoxGeometry(), rod = new T.CylinderGeometry(1, 1, 1, 8);

  function emit(shape, matrix, paint) {
    const positions = shape.getAttribute('position');
    const start = vertices.length / 3;
    color.setHex(paint);
    for (let i = 0; i < positions.count; i++) {
      v.fromBufferAttribute(positions, i).applyMatrix4(matrix);
      vertices.push(v.x, v.y, v.z);
      colors.push(color.r, color.g, color.b);
    }
    for (const i of shape.index.array) indices.push(start + i);
  }
  function block(x, y, z, width, height, depth, paint) {
    emit(box, new T.Matrix4().makeScale(width, height, depth).setPosition(x, y, z), paint);
  }
  function beam(start, end, radius, paint) {
    const a = new T.Vector3(...start), b = new T.Vector3(...end);
    const axis = b.clone().sub(a), length = axis.length();
    const rotation = new T.Quaternion().setFromUnitVectors(up, axis.normalize());
    emit(rod, new T.Matrix4().compose(a.lerp(b, .5), rotation, new T.Vector3(radius, length, radius)), paint);
  }

  const paint = 0xc45d35, rib = 0xcc7046, frame = 0x763d30;
  const corner = 0xb8a997, fittings = 0x98a29c, rubber = 0x303d3e;
  const x = CARGO_WIDTH / 2, z = CARGO_LENGTH / 2, roof = 1.48;
  block(0, .79, 0, 2*x-.06, 1.34, 2*z-.07, paint);
  block(0, roof, 0, 2*x, .065, 2*z, frame);
  for (let i = 0; i < 14; i++) {
    const along = -z+.19 + i*(2*z-.38)/13;
    for (const side of [-1, 1]) block(side*(x-.014), .79, along, .054, 1.19, .083, rib);
    block(0, roof+.031, along, 2*x-.17, .031, .085, rib);
  }
  for (const side of [-1, 1]) {
    block(side*(x-.10), .064, 0, .15, .128, 2*z-.02, rubber);
    for (const level of [.16, roof]) block(side*(x-.014), level, 0, .086, .092, 2*z, frame);
    for (const end of [-1, 1]) {
      block(side*(x-.038), .82, end*(z-.042), .11, 1.32, .11, frame);
      for (const level of [.16, roof]) {
        block(side*(x-.045), level, end*(z-.055), .15, .15, .18, corner);
      }
      beam([side*(x-.04), roof+.07, end*(z-.06)], [0, CARGO_EYE_HEIGHT-.08, 0], .019, fittings);
    }
    // Twin doors, hinges, locking rods and cam handles on the forward end.
    block(side*x*.485, .80, z-.007, x-.06, 1.19, .04, paint);
    block(side*x*.48, .80, z+.023, .032, 1.22, .033, fittings);
    for (const level of [.30, .84, 1.32]) {
      block(side*(x-.13), level, z+.019, .17, .054, .046, fittings);
    }
    block(side*x*.41, .63, z+.054, .17, .034, .043, rubber);
    block(side*(x+.021), 1.20, z-.32, .012, .13, .31, 0xd9ded1);
    block(side*(x+.029), 1.22, z-.32, .012, .025, .25, rubber);
  }
  const eye = new T.TorusGeometry(.084, .024, 7, 16);
  emit(eye, new T.Matrix4().setPosition(0, CARGO_EYE_HEIGHT, 0), 0xf0b43a);
  box.dispose();
  rod.dispose();
  eye.dispose();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
