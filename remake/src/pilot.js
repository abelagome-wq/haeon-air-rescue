import {FLEET} from './fleet.js';
import {clone} from '../vendor/three/addons/utils/SkeletonUtils.js';

// Cushion-top centers in glTF metres, +Y up and +Z toward the nose.
export const PILOT_SEATS = Object.freeze(Object.fromEntries(FLEET.map(h => [h.id, h.pilot])));

function seatedPose(T, body) {
    const bones = new Map();
    body.traverse(o => { if (o.isBone) bones.set(o.userData.name || o.name, o); });
    const bone = name => bones.get(name) || bones.get(name.replace('.', ''));
    body.updateMatrixWorld(true);
    const currentPos = o => o.getWorldPosition(new T.Vector3());
    function setWorldRotation(o, target) {
        const parent = o.parent.getWorldQuaternion(new T.Quaternion());
        o.quaternion.copy(parent.invert().multiply(target));
        o.updateWorldMatrix(true, true);
    }
    function aim(from, to, direction) {
        const joint = bone(from), child = bone(to);
        const axis = currentPos(child).sub(currentPos(joint)).normalize();
        const delta = new T.Quaternion().setFromUnitVectors(axis, new T.Vector3(...direction).normalize());
        setWorldRotation(joint, delta.multiply(joint.getWorldQuaternion(new T.Quaternion())));
    }
    for (const [side, sign] of [['L', 1], ['R', -1]]) {
        const foot = bone('Foot.' + side), neutralFoot = foot.getWorldQuaternion(new T.Quaternion());
        aim('Thigh.' + side, 'Shin.' + side, [sign * .12, .31, 1]);
        aim('Shin.' + side, 'Foot.' + side, [sign * .035, -.77, .64]);
        setWorldRotation(foot, neutralFoot);
        aim('UpperArm.' + side, 'Forearm.' + side, [sign * .25, -.86, .34]);
        aim('Forearm.' + side, 'Hand.' + side, [-sign * .27, -.10, .96]);
    }
    const hip = currentPos(bone('Thigh.L')).add(currentPos(bone('Thigh.R'))).multiplyScalar(.5);
    hip.y -= .095; hip.z += .045;
    return hip;
}

function textureSampler(T) {
    const images = new Map(), v = new T.Vector2(), sampled = new T.Color();
    function pixels(texture) {
        if (images.has(texture)) return images.get(texture);
        let info = null;
        if (typeof document !== 'undefined' && texture.image) {
            const image = texture.image, canvas = document.createElement('canvas');
            canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(image, 0, 0);
            info = { width: canvas.width, height: canvas.height, data: ctx.getImageData(0, 0, canvas.width, canvas.height).data };
        }
        images.set(texture, info); return info;
    }
    return (mat, uv, i) => {
        const tex = mat.map;
        if (!tex || !uv) return mat.color;
        const img = pixels(tex);
        // Headless geometry tests have no canvas; browser rendering samples the packed artwork.
        if (!img) return sampled.setRGB(.17, .22, .14).multiply(mat.color);
        v.fromBufferAttribute(uv, i); tex.transformUv(v);
        const x = Math.min(img.width - 1, Math.max(0, Math.floor(v.x * img.width)));
        const y = Math.min(img.height - 1, Math.max(0, Math.floor(v.y * img.height)));
        const n = (y * img.width + x) * 4, c = img.data;
        return sampled.setRGB(c[n] / 255, c[n + 1] / 255, c[n + 2] / 255, T.SRGBColorSpace).multiply(mat.color);
    };
}

function bakePilot(T, template) {
    const body = clone(template), hip = seatedPose(T, body), sample = textureSampler(T);
    const xyz = [], normals = [], colors = [], indices = [];
    const v = new T.Vector3(), n = new T.Vector3();
    body.traverse(o => {
        if (!o.isSkinnedMesh) return;
        o.skeleton.update();
        const original = o.geometry, g = original.clone(), p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
            o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld).sub(hip);
            p.setXYZ(i, v.x, v.y, v.z);
        }
        g.computeVertexNormals();
        const order = g.index;
        const groups = g.groups.length ? g.groups : [{ start: 0, count: order ? order.count : p.count, materialIndex: 0 }];
        for (const segment of groups) {
            const mat = Array.isArray(o.material) ? o.material[segment.materialIndex] : o.material;
            const local = new Map();
            for (let k = segment.start; k < segment.start + segment.count; k++) {
                const i = order ? order.getX(k) : k;
                if (!local.has(i)) {
                    local.set(i, xyz.length / 3); v.fromBufferAttribute(p, i);
                    n.fromBufferAttribute(g.getAttribute('normal'), i);
                    const c = sample(mat, g.getAttribute('uv'), i);
                    xyz.push(v.x, v.y, v.z); normals.push(n.x, n.y, n.z); colors.push(c.r, c.g, c.b);
                }
                indices.push(local.get(i));
            }
        }
        g.dispose(); o.skeleton.dispose();
    });
    const geo = new T.BufferGeometry();
    geo.setAttribute('position', new T.Float32BufferAttribute(xyz, 3));
    geo.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
    geo.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices); geo.computeBoundingBox();
    const mesh = new T.Mesh(geo, new T.MeshStandardMaterial({ vertexColors: true, roughness: .8 }));
    mesh.name = 'Seated City-Pilot'; return mesh;
}

export function createPilot(ctx, flight) {
    const { THREE: T, assets } = ctx;
    let disposed = false, model = null, current = null, requested = true;
    const result = {
        error: null,
        get ready() { return !!model; },
        update(show = true) {
            requested = show;
            if (!model) return;
            const id = flight.state.id, seat = PILOT_SEATS[id];
            model.visible = !!seat && show && !flight.state.onFoot && flight.state.cameraMode!=='조종실' && ctx.camera.position.distanceTo(flight.position) < 95;
            if (!seat || id === current) return;
            current = id; model.position.set(seat[0], seat[1], seat[2]); model.scale.setScalar(seat[3]);
        },
        dispose() {
            disposed = true;
            if (model) { model.removeFromParent(); model.geometry.dispose(); model.material.dispose(); model = null; }
        },
    };
    result.loaded = Promise.resolve().then(() => assets.load('models/traffic/people/lod1/City-Pilot-LOD1.glb')).then(template => {
        if (disposed) return;
        model = bakePilot(T, template); flight.object.add(model); result.update(requested);
    }).catch(error => { if (!disposed) { result.error = error.message; console.warn('[Sea Cliff cockpit pilot]', error); } });
    return result;
}
