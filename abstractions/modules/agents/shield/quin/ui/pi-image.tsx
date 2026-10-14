import type { ImageContent } from "./pi-content";
import type { JSX } from "@opentui/solid";
import { createMemo, splitProps } from "solid-js";

export type PiImageProps = Omit<JSX.IntrinsicElements["image"], "source"> & { content: ImageContent };

export function PiImage(props: PiImageProps) {
  const [local, native] = splitProps(props, ["content"]);
  const source = createMemo(() => new Blob([
    Uint8Array.from(atob(local.content.data), (char) => char.charCodeAt(0)),
  ], { type: local.content.mimeType }));
  return <image {...native} source={source()} />;
}
