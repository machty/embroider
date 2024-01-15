import type { PreparedApp } from 'scenario-tester';
import { appScenarios, baseAddon, renameApp } from './scenarios';
import { Transpiler } from '@embroider/test-support';
import type { ExpectFile } from '@embroider/test-support/file-assertions/qunit';
import { expectRewrittenFilesAt } from '@embroider/test-support/file-assertions/qunit';
import { throwOnWarnings } from '@embroider/core';
import merge from 'lodash/merge';
import { setupAuditTest } from '@embroider/test-support/audit-assertions';
import QUnit from 'qunit';
const { module: Qmodule, test } = QUnit;

let scenarios = appScenarios.map('compat-template-colocation', app => {
  renameApp(app, 'my-app');
  merge(app.files, {
    config: {
      'targets.js': `module.exports = { browsers: ['last 1 Chrome versions'] }`,
    },
    app: {
      templates: {
        'index.hbs': `
            <HasColocatedTemplate />
            <HasColocatedTSTemplate />
            <TemplateOnlyComponent />
          `,
      },
      components: {
        'has-colocated-template.js': `
          import Component from '@glimmer/component';
          export default class extends Component {}
          `,
        'has-colocated-template.hbs': `<div>{{this.title}}</div>`,
        'has-colocated-ts-template.ts': `
          import Component from '@glimmer/component';
          export default class extends Component {}
          `,
        'has-colocated-ts-template.hbs': `<div>{{this.title}}</div>`,
        'template-only-component.hbs': `<div>I am template only</div>`,
      },
    },
  });

  let addon = baseAddon();
  addon.pkg.name = 'my-addon';
  app.addDevDependency(addon);
  merge(addon.files, {
    app: {
      components: {
        'component-one.js': `export { default } from 'my-addon/components/component-one';`,
      },
    },
    addon: {
      components: {
        'component-one.js': `
          import Component from '@glimmer/component';
          export default class extends Component {}
        `,
        'component-one.hbs': `component one template`,
        'component-two.hbs': `component two templates`,
      },
    },
  });
});

scenarios
  .map('staticComponent-false', app => {
    merge(app.files, {
      'ember-cli-build.js': `
        'use strict';
        const EmberApp = require('ember-cli/lib/broccoli/ember-app');
        const { maybeEmbroider } = require('@embroider/test-setup');
        module.exports = function (defaults) {
          let app = new EmberApp(defaults, {});
          return maybeEmbroider(app, {
            staticComponents: false,
          });
        };
      `,
    });
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      throwOnWarnings(hooks);

      let app: PreparedApp;
      let expectFile: ExpectFile;
      let build: Transpiler;

      hooks.before(async assert => {
        app = await scenario.prepare();
        let result = await app.execute('ember build', { env: { STAGE2_ONLY: 'true' } });
        assert.equal(result.exitCode, 0, result.output);
      });

      let expectAudit = setupAuditTest(hooks, () => ({ app: app.dir }));

      hooks.beforeEach(assert => {
        expectFile = expectRewrittenFilesAt(app.dir, { qunit: assert });
        build = new Transpiler(app.dir);
      });

      test(`app's colocated template is associated with JS`, function () {
        let assertFile = expectFile('components/has-colocated-template.js').transform(build.transpile);
        assertFile.matches(/import TEMPLATE from ['"]\.\/has-colocated-template.hbs['"];/, 'imported template');
        assertFile.matches(/import \{ setComponentTemplate \}/, 'found setComponentTemplate');

        assertFile.matches(
          /export default setComponentTemplate\(TEMPLATE, class extends Component \{\}/,
          'default export is wrapped'
        );
      });

      test(`app's template-only component JS is synthesized`, function () {
        let assertFile = expectFile('components/template-only-component.js').transform(build.transpile);
        assertFile.matches(/import TEMPLATE from ['"]\.\/template-only-component.hbs['"];/, 'imported template');
        assertFile.matches(/import \{ setComponentTemplate \}/, 'found setComponentTemplate');
        assertFile.matches(/import templateOnlyComponent/, 'found templateOnlyComponent');

        assertFile.matches(
          /export default setComponentTemplate\(TEMPLATE, templateOnlyComponent\(\)\)/,
          'default export is wrapped'
        );
      });

      test(`app's colocated TS component is NOT synthesized`, function () {
        let assertFile = expectFile('components/has-colocated-ts-template.js');
        assertFile.doesNotExist('component stub was not created');
      });

      test(`app's colocated components are implicitly included correctly`, function () {
        let assertModule = expectAudit.module('assets/my-app.js').resolves('./-embroider-app-modules.js').toModule();

        assertModule.withContents(contents => {
          const [, objectName] = /"my-app\/components\/has-colocated-template": (appMod\d+),/.exec(contents) ?? [];

          return contents.includes(`import * as ${objectName} from "my-app\/components\/has-colocated-template.js";`);
        }, 'my-app/components/has-colocated-template.js import/export should be present in the virtual -embroider-app-modules.js file');

        assertModule.withContents(contents => {
          const [, objectName] = /"my-app\/components\/template-only-component": (appMod\d+),/.exec(contents) ?? [];

          return contents.includes(`import * as ${objectName} from "my-app\/components\/template-only-component.js";`);
        }, 'my-app/components/template-only-component.js import/export should be present in the virtual -embroider-app-modules.js file');
      });

      test(`addon's colocated template is associated with JS`, function () {
        let assertFile = expectFile('./node_modules/my-addon/components/component-one.js').transform(build.transpile);
        assertFile.matches(/import TEMPLATE from ['"]\.\/component-one.hbs['"];/, 'imported template');
        assertFile.matches(/import \{ setComponentTemplate \}/, 'found setComponentTemplate');
        assertFile.matches(
          /export default setComponentTemplate\(TEMPLATE, class extends Component \{\}/,
          'default export is wrapped'
        );
      });

      test(`addon's template-only component JS is synthesized`, function () {
        let assertFile = expectFile('./node_modules/my-addon/components/component-two.js').transform(build.transpile);
        assertFile.matches(/import TEMPLATE from ['"]\.\/component-two.hbs['"];/, 'imported template');
        assertFile.matches(/import \{ setComponentTemplate \}/, 'found setComponentTemplate');
        assertFile.matches(/import templateOnlyComponent/, 'found templateOnlyComponent');
        assertFile.matches(
          /export default setComponentTemplate\(TEMPLATE, templateOnlyComponent\(\)\)/,
          'default export is wrapped'
        );
      });

      test(`addon's colocated components are correct in implicit-modules`, function () {
        let assertFile = expectFile('./node_modules/my-addon/package.json').json();
        assertFile.get(['ember-addon', 'implicit-modules']).includes('./components/component-one');
        assertFile.get(['ember-addon', 'implicit-modules']).includes('./components/component-two');
        assertFile.get(['ember-addon', 'implicit-modules']).doesNotInclude('./components/component-one.hbs');
        assertFile.get(['ember-addon', 'implicit-modules']).doesNotInclude('./components/component-two.hbs');
      });
    });
  });

scenarios
  .map('staticComponents-true', app => {
    merge(app.files, {
      'ember-cli-build.js': `
        'use strict';
        const EmberApp = require('ember-cli/lib/broccoli/ember-app');
        const { maybeEmbroider } = require('@embroider/test-setup');
        module.exports = function (defaults) {
          let app = new EmberApp(defaults, {});
          return maybeEmbroider(app, {
            staticComponents: true,
            staticAddonTrees: true,
          });
        };
      `,
    });
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      throwOnWarnings(hooks);

      let app: PreparedApp;
      let expectFile: ExpectFile;

      hooks.before(async assert => {
        app = await scenario.prepare();
        let result = await app.execute('ember build', { env: { STAGE2_ONLY: 'true' } });
        assert.equal(result.exitCode, 0, result.output);
      });

      hooks.beforeEach(assert => {
        expectFile = expectRewrittenFilesAt(app.dir, { qunit: assert });
      });

      test(`app's colocated components are not implicitly included`, function () {
        let assertFile = expectFile('assets/my-app.js');
        assertFile.doesNotMatch(
          /d\(["']my-app\/components\/has-colocated-template["'], function\(\)\s*\{\s*return i\(["']my-app\/components\/has-colocated-template['"]\);\s*\}/
        );
        assertFile.doesNotMatch(
          /d\(["']my-app\/components\/template-only-component["'], function\(\)\s*\{\s*return i\(["']my-app\/components\/template-only-component['"]\);\s*\}/
        );
      });

      test(`addon's colocated components are not in implicit-modules`, function () {
        let assertFile = expectFile('./node_modules/my-addon/package.json').json();
        assertFile.get(['ember-addon', 'implicit-modules']).equals(undefined);
      });
    });
  });

appScenarios
  .map('compat-template-colocation-pods', app => {
    renameApp(app, 'my-app');
    merge(app.files, {
      'ember-cli-build.js': `
        'use strict';
        const EmberApp = require('ember-cli/lib/broccoli/ember-app');
        const { maybeEmbroider } = require('@embroider/test-setup');
        module.exports = function (defaults) {
          let app = new EmberApp(defaults, {});
          return maybeEmbroider(app, {
            staticComponents: false,
          });
        };
      `,

      config: {
        'environment.js': `module.exports = function(environment) {
          let ENV = {
            modulePrefix: 'my-app',
            podModulePrefix: '',
            environment,
            rootURL: '/',
            locationType: 'history',
            EmberENV: {
              FEATURES: {
              },
              EXTEND_PROTOTYPES: {
                Date: false
              }
            },
            APP: {}
          };
          return ENV;
        };`,
      },
      app: {
        templates: {
          'index.hbs': `
              <PodComponent />
              <TemplateOnly />
            `,
        },
        components: {
          'pod-component': {
            'component.js': `
            import Component from '@glimmer/component';
            export default class extends Component {}
            `,
            'template.hbs': `<div>{{this.title}}</div>`,
          },
          'template-only': {
            'template.hbs': `<div>I am template only</div>`,
          },
        },
      },
    });
  })
  .forEachScenario(scenario => {
    Qmodule(scenario.name, function (hooks) {
      throwOnWarnings(hooks);

      let app: PreparedApp;

      hooks.before(async assert => {
        app = await scenario.prepare();
        let result = await app.execute('ember build', { env: { STAGE2_ONLY: 'true' } });
        assert.equal(result.exitCode, 0, result.output);
      });

      let expectAudit = setupAuditTest(hooks, () => ({ app: app.dir }));

      test(`app's pod components and templates are implicitly included correctly`, function () {
        let assertModule = expectAudit.module('assets/my-app.js').resolves('./-embroider-app-modules.js').toModule();

        assertModule.withContents(contents => {
          console.log(contents);
          const [, objectName] = /"my-app\/components\/pod-component\/component": (appMod\d+),/.exec(contents) ?? [];

          return contents.includes(`import * as ${objectName} from "my-app\/components\/pod-component\/component.js";`);
        }, 'my-app/components/pod-component/component.js import/export should be present in the virtual -embroider-app-modules.js file');

        assertModule.withContents(contents => {
          const [, objectName] = /"my-app\/components\/pod-component\/template": (appMod\d+),/.exec(contents) ?? [];

          return contents.includes(`import * as ${objectName} from "my-app\/components\/pod-component\/template.hbs";`);
        }, 'my-app/components/pod-component/template.hbs import/export should be present in the virtual -embroider-app-modules.js file');

        assertModule.withContents(contents => {
          const [, objectName] = /"my-app\/components\/template-only\/template": (appMod\d+),/.exec(contents) ?? [];

          return contents.includes(`import * as ${objectName} from "my-app\/components\/template-only\/template.hbs";`);
        }, 'my-app/components/template-only/template.hbs import/export should be present in the virtual -embroider-app-modules.js file');
      });
    });
  });
