import { expect, test } from "bun:test";
import type { ImageContent } from "@earendil-works/pi-ai";
import { ImageRenderable, type NativeImage } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { PiImage } from "./pi-image";

const content: ImageContent = {
  type: "image", mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
};
const bytes = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082", "hex");

test("renders Pi image bytes with MIME, native props and native defaults", async () => {
  let image!: ImageRenderable;
  let defaults!: ImageRenderable;
  let native!: ImageRenderable;
  const loaded: NativeImage[] = [];
  const setup = await testRender(() => <box>
    <PiImage content={content} id="pi-image" width={6} height={3} fit="cover" protocol="blocks"
      ref={(node) => { image = node; }} onLoad={(value) => { loaded.push(value); }} />
    <PiImage content={content} ref={(node) => { defaults = node; }} />
    <image ref={(node) => { native = node; }} />
  </box>, { width: 20, height: 10 });
  try {
    await Promise.all([image.loadPromise, defaults.loadPromise]);
    await setup.flush();
    expect(image).toBeInstanceOf(ImageRenderable);
    expect(image.source).toBeInstanceOf(Blob);
    const source = image.source as Blob;
    expect(source.type).toBe(content.mimeType);
    expect(new Uint8Array(await source.arrayBuffer())).toEqual(new Uint8Array(bytes));
    expect(image.loadError).toBeNull();
    expect(image.image?.width).toBe(1); expect(image.image?.height).toBe(1);
    expect(loaded).toEqual([image.image!]);
    expect(image.id).toBe("pi-image");
    expect(image.width).toBe(6); expect(image.height).toBe(3);
    expect(image.fit).toBe("cover"); expect(image.protocol).toBe("blocks");
    expect(defaults.fit).toBe(native.fit); expect(defaults.protocol).toBe(native.protocol);
  } finally {
    setup.renderer.destroy();
  }
});
