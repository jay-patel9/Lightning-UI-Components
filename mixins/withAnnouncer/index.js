/**
 * Copyright 2021 Comcast Cable Communications Management, LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import Speech from './Speech';
import { debounce } from 'debounce';

const fiveMinutes = 300 * 1000;

function elmName(elm) {
  return elm.ref || elm.constructor.name;
}

export default (base, speak = Speech, options = {}) =>
  class Announcer extends base {
    _construct() {
      this._announceEndedTimeout;
      this._currentlySpeaking = '';
    }

    set announcerEnabled(val) {
      this._announcerEnabled = val;
      this._focusChange();
    }

    get announcerEnabled() {
      return this._announcerEnabled;
    }

    _voiceOut(toAnnounce) {
      if (this._voiceOutDisabled) {
        return;
      }
      const speech = speak(toAnnounce);
      // event using speech synthesis api promise
      if (speech && speech.series) {
        speech.series.then(() => {
          this.stage.emit('announceEnded');
        });
      }

      // event in case speech synthesis api is flakey,
      // assume the ammount of time it takes to read each word
      const toAnnounceStr = Array.isArray(toAnnounce)
        ? toAnnounce.concat().join(' ')
        : toAnnounce;
      const toAnnounceWords = toAnnounceStr.split(' ');
      const timeoutDelay =
        toAnnounceWords.length * (options.voiceOutDelay || 500);
      clearTimeout(this._announceEndedTimeout);
      this._announceEndedTimeout = setTimeout(() => {
        this.stage.emit('announceTimeoutEnded');
      }, timeoutDelay);

      return speech;
    }

    _build() {
      super._build && super._build();

      this._debounceAnnounceFocusChanges = debounce(
        this._announceFocusChanges.bind(this),
        Number.isInteger(this.announcerFocusDebounce)
          ? this.announcerFocusDebounce
          : 400
      );

      this.announcerTimeout = Number.isInteger(this.announcerTimeout)
        ? this.announcerTimeout
        : fiveMinutes;

      this._resetFocusTimer = debounce(() => {
        // Reset focus path for full announce
        this._lastFocusPath = undefined;
      }, this.announcerTimeout);
    }

    _firstEnable() {
      super._firstEnable && super._firstEnable();

      // Lightning only calls Focus Change on second focus
      this._focusChange();
    }

    _disable() {
      clearTimeout(this._announceEndedTimeout);
      this.stage.emit('announceEnded');
      this.stage.emit('announceTimeoutEnded');
    }

    _focusChange() {
      if (!this._resetFocusTimer) {
        return;
      }

      this._resetFocusTimer();
      this.$announcerCancel();
      this._debounceAnnounceFocusChanges();
    }

    _announceFocusChanges() {
      const focusPath = this.application.focusPath || [];
      const lastFocusPath = this._lastFocusPath || [];
      const loaded = focusPath.every(elm => !elm.loading);
      const focusDiff = focusPath.filter(elm => !lastFocusPath.includes(elm));

      if (!loaded) {
        this._debounceAnnounceFocusChanges();
        return;
      }

      this._lastFocusPath = focusPath.slice(0);
      // Provide hook for focus diff for things like TextBanner
      this.focusDiffHook = focusDiff;

      if (!this.announcerEnabled) {
        return;
      }

      let toAnnounce = focusDiff.reduce((acc, elm) => {
        if (elm.announce) {
          acc.push([elmName(elm), 'Announce', elm.announce]);
        } else if (elm.title) {
          acc.push([elmName(elm), 'Title', elm.title || '']);
        } else {
          acc.push([elmName(elm), 'Label', elm.label || '']);
        }
        return acc;
      }, []);

      focusDiff.reverse().reduce((acc, elm) => {
        if (elm.announceContext) {
          acc.push([elmName(elm), 'Context', elm.announceContext]);
        } else {
          acc.push([elmName(elm), 'No Context', '']);
        }
        return acc;
      }, toAnnounce);

      if (this.debug) {
        console.table(toAnnounce);
      }

      toAnnounce = toAnnounce.reduce((acc, a) => {
        const txt = a[2];
        txt && acc.push(txt);
        return acc;
      }, []);

      if (toAnnounce.length) {
        this.$announcerCancel();
        this._currentlySpeaking = this._voiceOut(
          toAnnounce.reduce((acc, val) => acc.concat(val), [])
        );
      }
    }

    $announce(toAnnounce, { append = false, notification = false } = {}) {
      if (this.announcerEnabled) {
        this._debounceAnnounceFocusChanges.flush();
        if (
          append &&
          this._currentlySpeaking &&
          this._currentlySpeaking.active
        ) {
          this._currentlySpeaking.append(toAnnounce);
        } else {
          this.$announcerCancel();
          this._currentlySpeaking = this._voiceOut(toAnnounce);
        }

        if (notification) {
          this._voiceOutDisabled = true;
          this._currentlySpeaking.series.finally(() => {
            this._voiceOutDisabled = false;
            this.$announcerRefresh();
          });
        }
      }
    }

    $announcerCancel() {
      this._currentlySpeaking && this._currentlySpeaking.cancel();
    }

    $announcerRefresh(depth) {
      if (depth) {
        this._lastFocusPath = this._lastFocusPath.slice(0, depth);
      } else {
        this._lastFocusPath = undefined;
      }
      this._resetFocusTimer();
      this._focusChange();
    }
  };
