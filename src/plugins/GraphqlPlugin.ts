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

import SwPlugin from '../core/SwPlugin';
import ContextManager from '../trace/context/ContextManager';
import PluginInstaller from '../core/PluginInstaller';
import { Component } from '../trace/Component';

function extractDetails(document: any, operationName: any) {
  var queries = [];
  var operation: any;

  if (document && Array.isArray(document.definitions)) {
    document.definitions.some(function (definition: any) {
      if (!definition || definition.kind !== 'OperationDefinition') return;
      if (!operationName && operation) return;
      if (!operationName || (definition.name && definition.name.value === operationName)) {
        operation = definition;
        return true;
      }
    });

    var selections = operation && operation.selectionSet && operation.selectionSet.selections;
    if (selections && Array.isArray(selections)) {
      for (const selection of selections) {
        const kind = selection.name && selection.name.kind;
        if (kind === 'Name') {
          const queryName = selection.name.value;
          if (queryName) queries.push(queryName);
        }
      }

      queries = queries.sort(function (a, b) {
        if (a > b) return 1;
        else if (a < b) return -1;
        return 0;
      });
    }
  } else {
    // console.log('unexpected document format - skipping graphql query extraction')
  }

  return { queries: queries, operation: operation };
}

class GraphqlPlugin implements SwPlugin {
  readonly module = 'graphql';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptServerRequest(installer);
  }

  private interceptServerRequest(installer: PluginInstaller) {
    try {
      // catch no graphql
      const graphqlExecute = installer.require('graphql/execution/execute');
      const _execute = graphqlExecute.execute;

      graphqlExecute.execute = function () {
        const span = ContextManager.currentSpan;
        if (span && arguments[0] && arguments[0].operationName) {
          span.setOperation(arguments[0].operationName);
          span.component = Component.GRAPHQL;
        } else if (span && arguments[1]) {
          let operationName = arguments[5];
          const details = extractDetails(arguments[1], arguments[5]);
          const queries = details.queries;
          operationName =
            operationName || (details.operation && details.operation.name && details.operation.name.value);
          span.component = Component.GRAPHQL;
          if (operationName) {
            span.setOperation(operationName);
          } else if (queries.length > 0) {
            span.setOperation(queries.join(', '));
          }
        }

        return _execute.apply(this, arguments);
      };
    } catch (e) {
      console.log('graphql ex:', e);
    }
  }
}

// noinspection JSUnusedGlobalSymbols
export default new GraphqlPlugin();
