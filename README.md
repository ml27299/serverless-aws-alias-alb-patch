# serverless-aws-alias-alb-patch [![npm version](https://img.shields.io/npm/v/serverless-aws-alias-alb-patch.svg)](https://www.npmjs.com/package/serverless-aws-alias-alb-patch)
This package fixes the bug in serverless-aws-alias where the alb event doesnt attach to the alias

## Getting Started
This package works in conjunction with the serverless-aws-alias package, so make sure to add the plugin after the serverless-aws-alias.
Any alb event configured with serverless should work with this package.

serverless.yml
```yaml
service: my-service

plugins:
  - serverless-aws-alias
  - serverless-aws-alias-alb-patch

functions:
  function:
    handler: "index.default"
    events:
      - alb:
          listenerArn: ${EXISTING_LISTENER_ARN}
          priority: ${file(priority.js):${self:provider.alias}}
          conditions:
            path:
              - /v1/
            method:
              - POST
```

Because of the way priorities work, you must supply a unique priority number for each alias. One way to do this is to make a js file
can reference variables from it.

priority.js
```javascript
module.exports.myStage = () => 1; //because of a bug where ${self:provider.alias} is the name of the stage even if you rename it using --masterAlias
module.exports.myMasterAlias = module.exports.myStage;
module.exports.otherAlias = () => 2;
```