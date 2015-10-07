/// <reference path="../typings/tsd.d.ts" />

import fs = require('fs');
import _ = require('lodash');
import path = require('path');
import yargs = require('yargs');

const requireDirectory = require('require-directory');
const traverse = require('traverse');
const stringify = require('json-stringify-safe');

// TODO: make class with defaults instead
export interface IConfigOptions {
  allDir?: string;
  envsDir?: string;
  specialDir?: string;
  localFile?: string;
  privateFile?: string;
  configDirPath?: string;
  envPrefix?: string;
  envSeparator?: string;
  argvPrefix?: string;
  argvSeparator?: string;
  environment?: string;
  keypathSplitRegExp?: RegExp;
}

// Allow {{foo}} interpolations (instead of lodash
// default <%= foo %>)
_.templateSettings.interpolate = /\{\{(.+?)\}\}/g;

export class Config {
  private $directoryTree: any;
  private $traversed: any;
  private $options: any;
  private $env: any;
  private env: string;

  Config = Config;

  // TODO: look for ssconfig.rc first for options
  constructor(options: IConfigOptions = {}) {
    if (!(this instanceof Config)) {
      return new Config(options);
    }

    this.$loadDefaultConfigs();
    this.$load(options);
  }

  defaultConfigOptions: IConfigOptions = {
    allDir: 'all',
    envsDir: 'env',
    specialDir: 'special',
    localFile: 'local',
    privateFile: 'private',
    configDirPath: path.join(process.cwd(), 'config'),
    envPrefix: 'config.',
    envSeparator: '.',
    argvPrefix: 'config.',
    argvSeparator: '.',
    environment: process.env.NODE_ENV || 'development',
    keypathSplitRegExp: /[\[\]\.]/
  };

  clientWhitelist: string[] = [
    '$get',
    '$set',
    '$merge',
    '$options',
    '$env',
    '$loadFromHost',
  ];

  // TOOD: option to not stringify for eval with funcitons, regex, etc
  $stringify() {
    // _.omit will flatten the object so we can iterate over instance and __proto__
    // keys
    const clone = _.omit(this);

    // Remove private methods not in whitelist
    for (const key in clone) {
      if (key[0] === '$' && !_.contains(this.clientWhitelist, key) || key === 'Config') {
        delete clone[key];
      }
    }

    // arbitrary sequence for escaping serialized values so qutoes can be found
    // and removed later
    const escapeSequence = '__escape__';
    const regexEscapedEscapeSequence = _.escapeRegExp(escapeSequence);
    const escapeSequenceRegex = new RegExp(
      `"${regexEscapedEscapeSequence}|${regexEscapedEscapeSequence}"`, 'g'
    );

    const escape = (item: string) => {
      return `${escapeSequence}${item}${escapeSequence}`;
    };

    const serialize = (key: string, value: any) => {
      if (_.isRegExp(value) || _.isFunction(value)) {
        return escape(value);
      } else {
        return value;
      }
    };

    const serialized = stringify(clone, serialize, 2);

    const deserialized: string = serialized
      .replace(escapeSequenceRegex, '')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '\n');

    return deserialized;
  }

  $toClientFile(prefix = 'window.config = ', suffix = ';') {
    return `${prefix}${this}${suffix}`;
  }

  $loadDefaultConfigs() {
    const rcPath = path.join(process.cwd(), '.ssrc');

    // Allow overriding options with an .ssrc file
    if (fs.existsSync(rcPath)) {
      _.extend(this.defaultConfigOptions, require(rcPath).config);
    }
  }

  /**
   * @todo - not workign as expected
   */
  $get(keyPath: string, property: string): any {
    const split = keyPath.split(this.$options.keypathSplitRegExp);

    let cursor: any = this;

    // This should actually be a string, but typescript for some
    // reason demands it must be a number...?
    let key: string;

    while (key = split.shift()) {
      console.log('cursor', key, cursor);
      cursor = cursor[key];
      if (!cursor) {
        break;
      }
    }

    if (property && cursor) {
      cursor = cursor[property] || cursor['default'] || cursor;
    }
    return cursor;
  }

  /**
   * @todo - not working as expected
   */
  $set(keyPath: string, value: any): Config {
    const split = keyPath.split(this.$options.keypathSplitRegExp);
    const numberRegExp = /^\d+$/;

    let cursor: any = this;
    let key: string;

    while (key = split.shift()) {
      if (!split.length) {
        cursor[key] = value;
      } else {
        if (cursor[key]) {
          cursor = cursor[key];
        } else {
          cursor = cursor[key] = numberRegExp.test(key) ? [] : {};
        }
      }
    }

    return this;
  }

  /**
   * Merge configs. Has fancy logic for arrays. By default
   * array values are concatted. Other options are 'replace' (supplied array
   * replaces the original), 'merge' (arrays are merged - default _.merge
   * behavior but rarely desired), 'prepend' prepends the new array to the
   * old.
   *
   * Define array behaviors by supplying one of the merge options as a
   * boolean value. Example way to configure would be:
   * { list: _.extend(['replaced-val'], { replace: true }) }
   *
   * @todo make $mergeType = 'value' instead? Properties get inherited
   * but would that actually happen?
   *
   * @param  {any}  value          Value to merge on top of context
   * @param  {any}  [context=this] Context that gets merged into
   * @return {any}                 Context supplied (or this) is returned
   */
  $merge(value: any, context: any = this) {
    return <Config>_.merge(context, value, (a: any, b: any) => {

      if (_.isArray(a) && _.isArray(b)) {
        if (b.replace) {
          // TODO: b.slice() so the replace param is gone for subsequent merged?
          // or good to keep?
          return b;
        } else if (b.merge) {
          return _.merge(a, b);
        } else if (b.prepend) {
          // TODO: _.extend(b.concat(a), { prepend: true }) to keep
          // behavior for subsequent merges?
          return b.concat(a);
        } else {
          return a.concat(b);
        }
      } else if (_.isObject(a) && _.isObject(b)) {
        return _.merge(a, b);
      } else {
        return b;
      }
    });
  }

  $load(options: IConfigOptions = {}): Config {
    this.$options = options;
    _.defaults(this.$options, this.defaultConfigOptions);

    const all = options.allDir;
    const configPath = path.resolve(options.configDirPath);
    let tree: any;

    // TODO: check for config dir existing first
    try {
      tree = this.$directoryTree = requireDirectory(module, configPath, {
        extensions: ['ts', 'js', 'json']
      });
    } catch (error) {
      console.error('Could not read config dir', error.stack);
      return this;
    }

    // Loop over 'all' configs and merge them alphabetically
    const keys = Object.keys(tree[all]).sort();
    keys.forEach((key) => {
      this.$merge(tree[all][key]);
    });

    // Merge in env files
    const envDir = tree[options.envsDir];
    if (envDir) {
      const envFile = envDir[options.environment];

      if (envFile) {
        this.$merge(envFile);
      }
    }

    this.$env = envDir;

    this.$merge(this.$getEnvConfigs());
    this.$merge(this.$getArgvConfigs());

    this.$processTemplates();

    return this;
  }

  // TODO: potential bugs in merging one env then
  // merging another env later
  $loadFromHost(host?: string) {
    if (!host) {
      try {
        host = window.location.host;
      } catch (error) {
        console.error('Could not load configs from host');
      }
    }

    for (const key in this.$env) {
      const value = this.$env[key];

      if (value && value.hostMatch) {
        if (host.match(new RegExp(value.hostMatch))) {
          this.env = key;
          this.$merge(value);
          break;
        }
      }
    }

    return this;
  }

  private $processTemplates() {
    const self = this;
    this.$traversed = traverse(this).forEach(function(item: any) {
      if (self.$containsTemplate(item)) {
        this.update(self.$processValueTemplate(item));
      }
    });
  }

  private $containsTemplate(item: any) {
    return typeof item === 'string' && _.contains(item, '<%');
  }

  /**
   * @todo allow lists, regex, etc
   */
  private $processValueTemplate(string: string): any {
    const result = _.template(string)(this);
    if (this.$containsTemplate(result)) {
      return this.$processValueTemplate(result);
    }
    return result;
  }

  private $getExternalConfigs(source: any, type: string): any {
    const out = {};
    const options = this.$options;
    const prefix = options[`${type}Prefix`];
    const separator = options[`${type}Separator`];
    const traversed = traverse(source);
    const separatorRe = new RegExp(_.escapeRegExp(separator), 'g');

    for (let key in source) {
      if (key.indexOf(prefix) === 0) {
        key = key.substr(prefix.length);
        key = key.replace(separatorRe, '.');

        let value = source[key];

        // Attempt to deserialize, e.g. 'null' -> null, '{}' -> {}
        // If we can't JSON parse, use the original string set
        try {
          value = JSON.parse(value);
        } finally {
          // do nothing
        }

        traversed.set(key, value);
      }
    }

    return out;
  }

  private $getArgvConfigs() {
    return this.$getExternalConfigs(yargs.argv, 'argv');
  }

  private $getEnvConfigs() {
    return this.$getExternalConfigs(process.env, 'env');
  }
}

const config = new Config();
module.exports = config;
export default config;
