/*!
 *
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 */

import * as fs from 'fs';
import * as path from 'path';
import SwPlugin from '../core/SwPlugin';
import { createLogger } from '../logging';
import * as semver from 'semver';
import config from '../config/AgentConfig';

const logger = createLogger(__filename);

let topModule = module;
while (topModule.parent) {
  const filename = topModule.filename;

  topModule = topModule.parent;

  if (filename.endsWith('/skywalking-nodejs/lib/index.js'))
    // stop at the appropriate level in case app is being run by some other framework
    break;
}

export default class PluginInstaller {
  private readonly pluginDir: string;
  readonly require: (name: string) => any = topModule.require.bind(topModule);
  readonly resolve = (request: string) => (module.constructor as any)._resolveFilename(request, topModule);

  constructor() {
    this.pluginDir = path.resolve(__dirname, '..', 'plugins');
  }

  private isBuiltIn = (module: string): boolean => this.resolve(module) === module;

  private checkModuleVersion = (plugin: SwPlugin): { version: string; isSupported: boolean } => {
    try {
      if (this.isBuiltIn(plugin.module)) {
        return {
          version: '*',
          isSupported: true,
        };
      }
    } catch {
      // module not found
      return {
        version: 'not found,',
        isSupported: false,
      };
    }

    let version = null;
    try {
      const packageJsonPath = this.resolve(`${plugin.module}/package.json`);
      version = this.require(packageJsonPath).version;
    } catch (e) {
      version = plugin.getVersion?.(this);
    }

    if (!semver.satisfies(version, plugin.versions)) {
      logger.info(`Plugin ${plugin.module} ${version} doesn't satisfy the supported version ${plugin.versions}`);
      return {
        version,
        isSupported: false,
      };
    }
    return {
      version,
      isSupported: true,
    };
  };

  isPluginEnabled = (name: string): boolean => !name.match(config.reDisablePlugins);

  install(): void {
    fs.readdirSync(this.pluginDir)
      .filter((file) => !(file.endsWith('.d.ts') || file.endsWith('.js.map')))
      .forEach((file) => {
        if (file.replace(/(?:Plugin)?\.js$/i, '').match(config.reDisablePlugins)) {
          logger.info(`Plugin ${file} not installed because it is disabled`);
          return;
        }

        let plugin;
        const pluginFile = path.join(this.pluginDir, file);

        try {
          plugin = this.require(pluginFile).default as SwPlugin;
          const { isSupported, version } = this.checkModuleVersion(plugin);

          if (!isSupported) {
            logger.info(`Plugin ${plugin.module} ${version} doesn't satisfy the supported version ${plugin.versions}`);
            return;
          }

          logger.info(`Installing plugin ${plugin.module} ${plugin.versions}`);

          plugin.install(this);
        } catch (e) {
          if (plugin) {
            logger.error(`Error installing plugin ${plugin.module} ${plugin.versions}`);
          } else {
            logger.error(`Error processing plugin ${pluginFile}`);
          }
        }
      });
  }
}
