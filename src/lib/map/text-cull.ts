// deck.gl extension: hide glyphs whose on-screen size is below a threshold instead of
// enlarging them (sizeMinPixels would blow tiny CAD labels up into unreadable clutter).
// Works per glyph on the GPU, so pan/zoom never rebuilds layers or attributes.
import { LayerExtension } from '@deck.gl/core';
import type { Layer } from '@deck.gl/core';

export interface TextCullOptions {
  /** Hide text whose em size in pixels is below this value. */
  minEmPixels: number;
}

export class TextSizeCullExtension extends LayerExtension<TextCullOptions> {
  static extensionName = 'TextSizeCullExtension';

  constructor(opts: TextCullOptions) {
    super(opts);
  }

  getShaders(this: Layer, extension: TextSizeCullExtension) {
    const min = Math.max(0, extension.opts.minEmPixels).toFixed(3);
    return {
      inject: {
        // `sizePixels` is the glyph em size computed at the top of IconLayer/MultiIconLayer main().
        'vs:#main-end': `if (sizePixels < ${min}) { gl_Position = vec4(0.0); }`,
      },
    };
  }
}
