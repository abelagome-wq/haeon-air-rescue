import { SRGBColorSpace, NearestFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter } from 'three';

// Apply before a GLTF is first rendered. One pool belongs to one asset-cache /
// renderer lifetime; never put ImageBitmaps from the inspector in the flight pool.
// THREE.Source sharing retains each Texture's UV transform/channel and sampler.
// Three's WebGLTextures cache separately keys wrap/filter/colour-space/alpha state.
export function createTexturePolicy(renderer, { colorAnisotropy = 8, dataAnisotropy = 4 } = {}) {
  const hardware = Math.max(1, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  const sources = new Map(), keys = new WeakMap(), prepared = new WeakSet();
  const stats = { textures: 0, uniqueImages: 0, sharedImages: 0, hardwareAnisotropy: hardware };
  function imageKey(parser, texture, modelURL) {
    const source = texture.source;
    if (keys.has(source)) return keys.get(source);
    const association = parser?.associations?.get(texture);
    const def = parser?.json?.textures?.[association?.textures];
    const index = def?.extensions?.EXT_texture_webp?.source ?? def?.extensions?.EXT_texture_avif?.source ?? def?.source;
    const image = parser?.json?.images?.[index];
    if (!image || texture.isCompressedTexture) return Promise.resolve(null);
    const job = (async () => {
      if (image.uri && !image.uri.startsWith('data:')) {
        // Resolve against the GLB itself: equal relative filenames in different
        // model folders are not evidence that the images contain equal pixels.
        try { return 'uri:' + new URL(image.uri, modelURL).href; } catch { return null; }
      }
      if (!globalThis.crypto?.subtle) return null;
      let bytes;
      if (image.bufferView !== undefined) bytes = await parser.getDependency('bufferView', image.bufferView);
      else if (image.uri?.startsWith('data:')) bytes = new TextEncoder().encode(image.uri);
      else return null;
      const hash = await crypto.subtle.digest('SHA-256', bytes);
      return 'sha256:' + Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
    })();
    keys.set(source, job);
    return job;
  }
  async function prepare(gltf, modelURL) {
    const textures = new Set();
    for (const scene of gltf.scenes || [gltf.scene]) scene?.traverse(o => {
      for (const m of [].concat(o.material || [])) for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    });
    await Promise.all([...textures].map(async texture => {
      if (prepared.has(texture)) return;
      prepared.add(texture); stats.textures++;
      // Respect explicitly authored nearest / non-mip filters. All current
      // exported colour surfaces already request linear trilinear mipmaps.
      const pixelArt = texture.magFilter === NearestFilter ||
        texture.minFilter === NearestFilter || texture.minFilter === NearestMipmapNearestFilter || texture.minFilter === NearestMipmapLinearFilter;
      const wanted = pixelArt ? 1 : Math.max(1, Math.min(hardware,
        texture.colorSpace === SRGBColorSpace ? colorAnisotropy : dataAnisotropy));
      if (texture.anisotropy !== wanted) { texture.anisotropy = wanted; texture.needsUpdate = true; }
      // Hash/read failures must not prevent a valid model from loading.
      const key = await imageKey(gltf.parser, texture, modelURL).catch(() => null);
      if (!key) return;
      const prior = sources.get(key);
      if (prior) {
        if (texture.source !== prior) { texture.source = prior; stats.sharedImages++; }
      } else { sources.set(key, texture.source); stats.uniqueImages++; }
    }));
    return gltf;
  }
  return { prepare, stats };
}

// Call only after all textures in an isolated inspector model are disposed.
// The flight cache owns its source images until its renderer/cache is retired.
export function closeTextureImages(textures) {
  const images = new Set();
  for (const texture of textures) if (texture.source?.data) images.add(texture.source.data);
  for (const image of images) image.close?.();
}
