/// <reference path="../../typings/tsd.d.ts" />
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
export declare class Config {
    private $directoryTree;
    private $traversed;
    private $options;
    constructor(options?: IConfigOptions);
    defaultConfigOptions: IConfigOptions;
    clientWhitelist: string[];
    toString(): any;
    $toClientFile(prefix?: string, suffix?: string): string;
    $loadDefaultConfigs(): void;
    /**
     * @todo - do without libs so can use on client too
     */
    $get(keyPath: string, property: string): any;
    $set(keyPath: string, value: any): Config;
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
    $merge(value: any, context?: any): Config;
    $load(options?: IConfigOptions): Config;
    private $processTemplates();
    private $containsTemplate(item);
    /**
     * @todo allow lists, regex, etc
     */
    private $processValueTemplate(string);
    private $getExternalConfigs(source, type);
    private $getArgvConfigs();
    private $getEnvConfigs();
}
declare const config: Config;
export default config;
