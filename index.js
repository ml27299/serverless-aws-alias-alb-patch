const crypto = require("crypto");
const isObject = (obj) => Object.prototype.toString.call(obj) === '[object Object]';
const isArray = Array.isArray;

const required = (param) => throw (`Missing param: ${param}`);

class AlbAlias {

    constructor(serverless, options) {
        this.serverless = serverless;
        this.options = options || {};
        this.provider = this.serverless.getProvider('aws');
        this.hooks = {
            "before:package:finalize": this.init.bind(this),
            "before:deploy:deploy": this.run.bind(this)
        };
    }

    get alias() {
        return this.provider.naming.getNormalizedFunctionName(this.serverless.service.provider.alias);
    }

    generateMd5Hash(val) {
        return crypto.createHash('md5').update(val).digest("hex");
    }

    findTargetGroups(stack = required`stack`) {
        const targetGroupKeys = Object.keys(stack.Resources)
            .filter(resourceKey => stack.Resources[resourceKey].Type === "AWS::ElasticLoadBalancingV2::TargetGroup");
        return targetGroupKeys.reduce((result, resourceKey) =>
            Object.assign(result, {[`${resourceKey}`]: stack.Resources[resourceKey]}), {});
    }

    findRules(stack = required`stack`) {
        const ruleKeys = Object.keys(stack.Resources)
            .filter(resourceKey => stack.Resources[resourceKey].Type === "AWS::ElasticLoadBalancingV2::ListenerRule");
        return ruleKeys.reduce((result, resourceKey) =>
            Object.assign(result, {[`${resourceKey}`]: stack.Resources[resourceKey]}), {});
    }

    findPermissions(stack = required`stack`) {
        const permissionResourceKeys = Object.keys(stack.Resources)
            .filter(resourceKey => stack.Resources[resourceKey].Type === "AWS::Lambda::Permission");
        if (permissionResourceKeys.length === 0) return;
        const resourceKeys = permissionResourceKeys.filter(permissionResourceKey =>
            stack.Resources[permissionResourceKey].Properties.Principal === "elasticloadbalancing.amazonaws.com");
        return resourceKeys.reduce((result, resourceKey) =>
            Object.assign(result, {[`${resourceKey}`]: stack.Resources[resourceKey]}), {});
    }

    transform(functionName = required`functionName`, {permissionResource, ruleResource, targetGroup}) {
        const resourceObj = Object.assign(permissionResource, ruleResource, targetGroup);
        const replaceRefs = (target, value, obj) => {
            if (isArray(obj)) {
                obj.forEach((item, index) => {
                    if (isArray(item) || isObject(item)) replaceRefs(target, value, item);
                    else if (item === target) obj[index] = value;
                });
                return;
            }
            for (const key in obj) {
                if (obj.hasOwnProperty(key) === false) continue;
                if (isObject(obj[key]) || isArray(obj[key])) replaceRefs(target, value, obj[key]);
                else if (obj[key] === target) obj[key] = value;
                if (key === target) {
                    obj[value] = obj[key];
                    delete obj[key];
                }
            }
        };

        const reNameMapping = Object.keys(resourceObj).reduce((result, key) =>
            Object.assign(result, {[`${key}`]: key.replace(`${functionName}`, `${functionName}${this.alias}`)}), {});

        for (const key in reNameMapping) {
            if (reNameMapping.hasOwnProperty(key) === false) continue;
            replaceRefs(key, reNameMapping[key], resourceObj)
        }

        return resourceObj;
    }

    init() {

        const stageStack = this.serverless.service.provider.compiledCloudFormationTemplate;
        this.permissionResources = this.findPermissions(stageStack);
        this.ruleResources = this.findRules(stageStack);
        this.targetGroups = this.findTargetGroups(stageStack);

        const keys = Object.keys(this.permissionResources)
            .concat(Object.keys(this.ruleResources))
            .concat(Object.keys(this.targetGroups));

        for (let key of keys) {
            delete stageStack.Resources[key];
        }
    }

    run() {
        const aliasStack = this.serverless.service.provider.compiledCloudFormationAliasTemplate;
        for (const functionName in this.serverless.service.functions) {
            if (this.serverless.service.functions.hasOwnProperty(functionName) === false) continue;

            const normalizedFunctionName = this.provider.naming.getNormalizedFunctionName(functionName);
            const targetGroups = Object.keys(this.targetGroups).reduce((result, key) => {
                if (key.substr(0, normalizedFunctionName.length) !== normalizedFunctionName) return result;
                return Object.assign(result, {[`${key}`]: this.targetGroups[key]});
            }, {});
            const ruleResources = Object.keys(this.ruleResources).reduce((result, key) => {
                if (key.substr(0, normalizedFunctionName.length) !== normalizedFunctionName) return result;
                return Object.assign(result, {[`${key}`]: this.ruleResources[key]});
            }, {});
            const permissionResources = Object.keys(this.permissionResources).reduce((result, key) => {
                if (key.substr(0, normalizedFunctionName.length) !== normalizedFunctionName) return result;
                return Object.assign(result, {[`${key}`]: this.permissionResources[key]});
            }, {});


            for (let key in targetGroups) {
                if (this.targetGroups.hasOwnProperty(key) === false) continue;
                if (key.substr(0, normalizedFunctionName.length) !== normalizedFunctionName) continue;
                this.targetGroups[key].Properties.Targets[0].Id = {
                    "Ref": `${normalizedFunctionName}Alias`
                };
                if (!targetGroups[key].DependsOn) targetGroups[key].DependsOn = [];
                this.targetGroups[key].DependsOn.push(`${normalizedFunctionName}Alias`);
                this.targetGroups[key].Properties.Name = this.generateMd5Hash(`${normalizedFunctionName}${this.alias}${key}`);
            }

            for (let key in permissionResources) {
                if (this.permissionResources.hasOwnProperty(key) === false) continue;
                this.permissionResources[key].Properties.FunctionName = {
                    "Ref": `${normalizedFunctionName}Alias`
                };
                if (!permissionResources[key].DependsOn) permissionResources[key].DependsOn = [];
                this.permissionResources[key].DependsOn.push(`${normalizedFunctionName}Alias`)
            }

            Object.assign(aliasStack.Resources, this.transform(normalizedFunctionName, {
                permissionResource: permissionResources,
                ruleResource: ruleResources,
                targetGroup: targetGroups
            }));
        }
    }
}

module.exports = AlbAlias;

