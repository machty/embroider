import { default as hbs } from './rollup-hbs-plugin';
import { default as glint } from './rollup-glint-plugin';
import { default as gjs } from './rollup-gjs-plugin';
import { default as publicEntrypoints } from './rollup-public-entrypoints';
import { default as appReexports } from './rollup-app-reexports';
import type { Options as DelOptions } from 'rollup-plugin-delete';
import { default as clean } from 'rollup-plugin-delete';
import { default as keepAssets } from './rollup-keep-assets';
import { default as dependencies } from './rollup-addon-dependencies';
import { default as publicAssets } from './rollup-public-assets';
import type { Plugin } from 'rollup';

export class Addon {
  #srcDir: string;
  #destDir: string;

  constructor(params: { srcDir?: string; destDir?: string } = {}) {
    this.#srcDir = params.srcDir ?? 'src';
    this.#destDir = params.destDir ?? 'dist';
  }

  // Given a list of globs describing modules in your srcDir, this generates
  // corresponding appTree modules that contain reexports, and updates your
  // package.json metadata to list them all.
  appReexports(
    patterns: string[],
    opts: { mapFilename?: (fileName: string) => string } = {}
  ): Plugin {
    return appReexports({
      from: this.#srcDir,
      to: this.#destDir,
      include: patterns,
      mapFilename: opts.mapFilename,
    });
  }

  // This configures rollup to emit public entrypoints for each module in your
  // srcDir that matches one of the given globs. Typical addons will want to
  // match patterns like "components/**/*.js", "index.js", and "test-support.js".
  publicEntrypoints(patterns: string[]) {
    return publicEntrypoints({ srcDir: this.#srcDir, include: patterns });
  }

  // This wraps standalone .hbs files as Javascript files using inline
  // templates. This means special resolving rules for .hbs files aren't
  // required for javascript tooling to understand your package.
  hbs() {
    return hbs();
  }

  gjs() {
    return gjs();
  }

  glint(pattern: string) {
    return glint(pattern);
  }

  // By default rollup does not clear the output directory between builds. This
  // does that.
  clean(options: DelOptions) {
    return clean({ targets: `${this.#destDir}/*`, ...options });
  }

  // V2 Addons are allowed to contain imports of .css files. This tells rollup
  // to leave those imports alone and to make sure the corresponding .css files
  // are kept in the same relative locations in the destDir as they were in the
  // srcDir.
  keepAssets(patterns: string[]) {
    return keepAssets({
      from: this.#srcDir,
      include: patterns,
    });
  }

  // This is the default `output` configuration you should pass to rollup. We're
  // emitting ES modules, in your `destDir`, and their filenames are equal to
  // their bundle names (the bundle names get generated by `publicEntrypoints`
  // above).
  //
  // hoistTransitiveImports is disabled because the purpose of hoisting transitive imports
  // is to improve performance of apps loading modules.
  // Since v2 addons do not know exactly how they'll be used, this performance decision
  // is left up to apps.
  output() {
    return {
      dir: this.#destDir,
      entryFileNames: '[name]',
      experimentalMinChunkSize: 0,
      format: 'es',
      hoistTransitiveImports: false,
      sourcemap: true,
    };
  }

  dependencies() {
    return dependencies();
  }

  publicAssets(path: string, opts: { include: string[]; exclude: string[] }) {
    return publicAssets(path, opts);
  }
}
