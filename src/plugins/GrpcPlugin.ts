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
import Span from 'trace/span/Span';
import Tag from '../Tag';

class GrpcPlugin implements SwPlugin {
  readonly module = 'grpc';
  readonly versions = '*';

  install(installer: PluginInstaller): void {
    this.interceptServerRequest(installer);
  }

  private interceptServerRequest(installer: PluginInstaller) {
    try {
      // catch no module
      const grpcInterceptors = installer.require('grpc/src/client_interceptors');
      const _getInterceptingCall = grpcInterceptors.getInterceptingCall;
      const _getLastListener = grpcInterceptors.getLastListener;
      let span: Span;

      grpcInterceptors.getInterceptingCall = function () {
        const InterceptingCall = _getInterceptingCall.apply(this, arguments);
        const _start = InterceptingCall.start;
        const _cancelWithStatus = InterceptingCall.cancelWithStatus;
        const _cancel = InterceptingCall.cancel;
        const path = arguments[0].path;
        let operation = path;
        const split = path.split('/');
        let peer = '';
        if (split.length && split.length === 3) {
          operation = split[2];
          peer = split[1];
        }

        InterceptingCall.start = function () {
          span = ContextManager.current.newExitSpan(operation, Component.GRPC);
          span.component = Component.GRPC;
          span.peer = peer;
          span.start();
          const metadata = arguments[0];
          span.inject().items.forEach((item) => {
            metadata.add(item.key, item.value);
          });
          return _start.apply(this, arguments);
        };

        InterceptingCall.cancel = function () {
          span.stop();
          return _cancel.apply(this, arguments);
        };

        InterceptingCall.cancelWithStatus = function () {
          span.stop();
          return _cancelWithStatus.apply(this, arguments);
        };

        return InterceptingCall;
      };
      grpcInterceptors.getLastListener = function () {
        const LastListener = _getLastListener.apply(this, arguments);
        const _onReceiveStatus = LastListener.onReceiveStatus;
        span = ContextManager.currentSpan;
        LastListener.onReceiveStatus = function () {
          if (span) {
            const status = arguments[0].code;
            span.tag(Tag.httpStatusCode(status));
            if (status !== 0) {
              span.errored = true;
            }
            span.stop();
          }
          return _onReceiveStatus.apply(this, arguments);
        };
        span.async();
        return LastListener;
      };
    } catch (e) {
      console.log(e);
    }
  }
}

// noinspection JSUnusedGlobalSymbols
export default new GrpcPlugin();
