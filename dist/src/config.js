/// <reference path="../typings/tsd.d.ts" />
var fs = require('fs');
var _ = require('lodash');
var path = require('path');
var yargs = require('yargs');
var requireDirectory = require('require-directory');
var traverse = require('traverse');
var stringify = require('json-stringify-save');
var Config = (function () {
    // TODO: look for ssconfig.rc first for options
    function Config(options) {
        if (options === void 0) { options = {}; }
        this.defaultConfigOptions = {
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
        this.clientWhitelist = [
            '$get',
            '$set',
            '$merge'
        ];
        if (!(this instanceof Config)) {
            return new Config(options);
        }
        this.$loadDefaultConfigs();
        this.$load(options);
    }
    Config.prototype.toString = function () {
        var clone = _.clone(this);
        // Remove private methods not in whitelist
        for (var key in clone) {
            if (key[0] === '$' && !_.contains(this.clientWhitelist, key)) {
                delete clone[key];
            }
        }
        // arbitrary sequence for escaping serialized values so qutoes can be found
        // and removed later
        var escapeSequence = '__escape__';
        var regexEscapedEscapeSequence = _.escapeRegExp(escapeSequence);
        var escapeSequenceRegex = new RegExp("\"" + regexEscapedEscapeSequence + "|" + regexEscapedEscapeSequence + "\"", 'g');
        var escape = function (item) {
            return "" + escapeSequence + item + escapeSequence;
        };
        var serialize = function (item) {
            if (_.isRegExp(item) || _.isFunction(item)) {
                return escape(item);
            }
            else {
                return item;
            }
        };
        var serialized = stringify(clone, serialize, 2);
        var deserialized = serialized.replace(escapeSequenceRegex, '');
        return deserialized;
    };
    Config.prototype.$toClientFile = function (prefix, suffix) {
        if (prefix === void 0) { prefix = 'window.config = '; }
        if (suffix === void 0) { suffix = ';'; }
        return "" + prefix + this + suffix;
    };
    Config.prototype.$loadDefaultConfigs = function () {
        var rcPath = path.join(process.cwd(), '.ssrc');
        // Allow overriding options with an .ssrc file
        if (fs.existsSync(rcPath)) {
            _.extend(this.defaultConfigOptions, require(rcPath).config);
        }
    };
    /**
     * @todo - do without libs so can use on client too
     */
    Config.prototype.$get = function (keyPath, property) {
        var split = keyPath.split(this.$options.keypathSplitRegExp);
        var cursor = this;
        // This should actually be a string, but typescript for some
        // reason demands it must be a number...?
        var key;
        while (key = split.unshift()) {
            cursor = cursor[key];
            if (!cursor) {
                break;
            }
        }
        if (property && cursor) {
            cursor = cursor[property] || cursor.default || cursor;
        }
        return cursor;
    };
    Config.prototype.$set = function (keyPath, value) {
        var split = keyPath.split(this.$options.keypathSplitRegExp);
        var numberRegExp = /^\d+$/;
        var cursor = this;
        var key;
        while (key = split.unshift()) {
            if (!split.length) {
                cursor[key] = value;
            }
            else {
                if (cursor[key]) {
                    cursor = cursor[key];
                }
                else {
                    cursor = cursor[key] = numberRegExp.test(key) ? [] : {};
                }
            }
        }
        return this;
    };
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
    Config.prototype.$merge = function (value, context) {
        if (context === void 0) { context = this; }
        return _.merge(context, value, function (a, b) {
            if (_.isArray(a) && _.isArray(b)) {
                if (b.replace) {
                    // TODO: b.slice() so the replace param is gone for subsequent merged?
                    // or good to keep?
                    return b;
                }
                else if (b.merge) {
                    return _.merge(a, b);
                }
                else if (b.prepend) {
                    // TODO: _.extend(b.concat(a), { prepend: true }) to keep
                    // behavior for subsequent merges?
                    return b.concat(a);
                }
                else {
                    return a.concat(b);
                }
            }
            else if (_.isObject(a) && _.isObject(b)) {
                return _.merge(a, b);
            }
            else {
                return b;
            }
        });
    };
    Config.prototype.$load = function (options) {
        var _this = this;
        if (options === void 0) { options = {}; }
        this.$options = options;
        _.defaults(this.$options, this.defaultConfigOptions);
        var all = options.allDir;
        var configPath = path.resolve(options.configDirPath);
        var tree = this.$directoryTree = requireDirectory(module, configPath, {
            extensions: ['ts', 'js', 'json']
        });
        // Loop over 'all' configs and merge them alphabetically
        var keys = Object.keys(tree[all]).sort();
        keys.forEach(function (key) {
            _this.$merge(tree[all][key]);
        });
        // Merge in env files
        var envDir = tree[options.envsDir];
        if (envDir) {
            var envFile = envDir[options.environment];
            if (envFile) {
                this.$merge(envFile);
            }
        }
        this.$merge(this.$getEnvConfigs());
        this.$merge(this.$getArgvConfigs());
        this.$processTemplates();
        return this;
    };
    Config.prototype.$processTemplates = function () {
        var self = this;
        this.$traversed = traverse(this).forEach(function (item) {
            if (self.$containsTemplate(item)) {
                this.update(self.$processValueTemplate(item));
            }
        });
    };
    Config.prototype.$containsTemplate = function (item) {
        return typeof item === 'string' && _.contains(item, '<%');
    };
    /**
     * @todo allow lists, regex, etc
     */
    Config.prototype.$processValueTemplate = function (string) {
        var result = _.template(string)(this);
        if (this.$containsTemplate(result)) {
            return this.$processValueTemplate(result);
        }
        return result;
    };
    Config.prototype.$getExternalConfigs = function (source, type) {
        var out = {};
        var options = this.$options;
        var prefix = options[(type + "Prefix")];
        var separator = options[(type + "Separator")];
        var traversed = traverse(source);
        var separatorRe = new RegExp(_.escapeRegExp(separator), 'g');
        for (var key in source) {
            if (key.indexOf(prefix) === 0) {
                key = key.substr(prefix.length);
                key = key.replace(separatorRe, '.');
                var value = source[key];
                // Attempt to deserialize, e.g. 'null' -> null, '{}' -> {}
                // If we can't JSON parse, use the original string set
                try {
                    value = JSON.parse(value);
                }
                finally {
                }
                traversed.set(key, value);
            }
        }
        return out;
    };
    Config.prototype.$getArgvConfigs = function () {
        return this.$getExternalConfigs(yargs.argv, 'argv');
    };
    Config.prototype.$getEnvConfigs = function () {
        return this.$getExternalConfigs(process.env, 'env');
    };
    return Config;
})();
exports.Config = Config;
var config = new Config();
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = config;
module.exports = config;
