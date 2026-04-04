import * as cdk from 'aws-cdk-lib'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import { Construct } from 'constructs'
import * as path from 'path'

export class JibunIkuseiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // ---- DynamoDB ----
    const table = new dynamodb.Table(this, 'Table', {
      tableName: 'jibun-ikusei-cdk',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      timeToLiveAttribute: 'ttl',
    })

    // ---- Cognito ----
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'jibun-ikusei-users-cdk',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: false,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'jibun-ikusei-web-cdk',
      authFlows: {
        userSrp: true,
      },
      generateSecret: false,
    })

    // ---- Lambda ----
    const getStateFn = new lambda.Function(this, 'GetState', {
      functionName: 'jibun-ikusei-getState-cdk',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/getState')),
      environment: { TABLE_NAME: table.tableName },
      timeout: cdk.Duration.seconds(10),
    })

    const putStateFn = new lambda.Function(this, 'PutState', {
      functionName: 'jibun-ikusei-putState-cdk',
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/putState')),
      environment: { TABLE_NAME: table.tableName },
      timeout: cdk.Duration.seconds(10),
    })

    table.grantReadData(getStateFn)
    table.grantWriteData(putStateFn)

    // ---- Lambda (個別API) ----
    const sharedLayer = new lambda.LayerVersion(this, 'SharedLayer', {
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/shared-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description: 'Shared utilities for Lambda functions',
    })

    const lambdaDefaults = {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      environment: { TABLE_NAME: table.tableName },
      timeout: cdk.Duration.seconds(10),
      layers: [sharedLayer],
    }

    const questFn = new lambda.Function(this, 'QuestHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-questHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/questHandler')),
    })

    const completionFn = new lambda.Function(this, 'CompletionHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-completionHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/completionHandler')),
    })

    const skillFn = new lambda.Function(this, 'SkillHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-skillHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/skillHandler')),
    })

    const userConfigFn = new lambda.Function(this, 'UserConfigHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-userConfigHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/userConfigHandler')),
    })

    const messageFn = new lambda.Function(this, 'MessageHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-messageHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/messageHandler')),
    })

    const activityLogFn = new lambda.Function(this, 'ActivityLogHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-activityLogHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/activityLogHandler')),
    })

    const browsingTimeFn = new lambda.Function(this, 'BrowsingTimeHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-browsingTimeHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/browsingTimeHandler')),
    })

    const healthDataFn = new lambda.Function(this, 'HealthDataHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-healthDataHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/healthDataHandler')),
    })

    const situationLogFn = new lambda.Function(this, 'SituationLogHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-situationLogHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/situationLogHandler')),
    })

    const chatFn = new lambda.Function(this, 'ChatHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-chatHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/chatHandler')),
    })

    const migrateStateFn = new lambda.Function(this, 'MigrateState', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-migrateState',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/migrateState')),
      timeout: cdk.Duration.seconds(60),
    })

    const nutritionFn = new lambda.Function(this, 'NutritionHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-nutritionHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/nutritionHandler')),
    })

    const fitbitDataFn = new lambda.Function(this, 'FitbitDataHandler', {
      ...lambdaDefaults,
      functionName: 'jibun-ikusei-fitbitDataHandler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../lambda/fitbitDataHandler')),
    })

    for (const fn of [questFn, completionFn, skillFn, userConfigFn, messageFn, browsingTimeFn, healthDataFn, activityLogFn, situationLogFn, chatFn, migrateStateFn, nutritionFn, fitbitDataFn]) {
      table.grantReadWriteData(fn)
    }

    // ---- API Gateway (HTTP API) ----
    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      {
        jwtAudience: [userPoolClient.userPoolClientId],
      },
    )

    const api = new apigwv2.HttpApi(this, 'Api', {
      apiName: 'jibun-ikusei-api-cdk',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.PUT,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.DELETE,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      defaultAuthorizer: jwtAuthorizer,
    })

    api.addRoutes({
      path: '/sync',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('GetStateIntegration', getStateFn),
    })

    api.addRoutes({
      path: '/sync',
      methods: [apigwv2.HttpMethod.PUT],
      integration: new integrations.HttpLambdaIntegration('PutStateIntegration', putStateFn),
    })

    // ---- 個別APIルート ----
    const questIntegration = new integrations.HttpLambdaIntegration('QuestIntegration', questFn)
    const completionIntegration = new integrations.HttpLambdaIntegration('CompletionIntegration', completionFn)
    const skillIntegration = new integrations.HttpLambdaIntegration('SkillIntegration', skillFn)
    const userConfigIntegration = new integrations.HttpLambdaIntegration('UserConfigIntegration', userConfigFn)
    const messageIntegration = new integrations.HttpLambdaIntegration('MessageIntegration', messageFn)

    // Quests
    api.addRoutes({ path: '/quests', methods: [apigwv2.HttpMethod.GET], integration: questIntegration })
    api.addRoutes({ path: '/quests', methods: [apigwv2.HttpMethod.POST], integration: questIntegration })
    api.addRoutes({ path: '/quests/{id}', methods: [apigwv2.HttpMethod.PUT], integration: questIntegration })
    api.addRoutes({ path: '/quests/{id}', methods: [apigwv2.HttpMethod.DELETE], integration: questIntegration })

    // Completions
    api.addRoutes({ path: '/completions', methods: [apigwv2.HttpMethod.GET], integration: completionIntegration })
    api.addRoutes({ path: '/completions', methods: [apigwv2.HttpMethod.POST], integration: completionIntegration })
    api.addRoutes({ path: '/completions/{id}', methods: [apigwv2.HttpMethod.PUT], integration: completionIntegration })

    // Skills
    api.addRoutes({ path: '/skills', methods: [apigwv2.HttpMethod.GET], integration: skillIntegration })
    api.addRoutes({ path: '/skills', methods: [apigwv2.HttpMethod.POST], integration: skillIntegration })
    api.addRoutes({ path: '/skills/{id}', methods: [apigwv2.HttpMethod.PUT], integration: skillIntegration })

    // User / Settings / AiConfig / Meta
    api.addRoutes({ path: '/user', methods: [apigwv2.HttpMethod.GET], integration: userConfigIntegration })
    api.addRoutes({ path: '/user', methods: [apigwv2.HttpMethod.PUT], integration: userConfigIntegration })
    api.addRoutes({ path: '/settings', methods: [apigwv2.HttpMethod.GET], integration: userConfigIntegration })
    api.addRoutes({ path: '/settings', methods: [apigwv2.HttpMethod.PUT], integration: userConfigIntegration })
    api.addRoutes({ path: '/ai-config', methods: [apigwv2.HttpMethod.GET], integration: userConfigIntegration })
    api.addRoutes({ path: '/ai-config', methods: [apigwv2.HttpMethod.PUT], integration: userConfigIntegration })
    api.addRoutes({ path: '/meta', methods: [apigwv2.HttpMethod.GET], integration: userConfigIntegration })
    api.addRoutes({ path: '/meta', methods: [apigwv2.HttpMethod.PUT], integration: userConfigIntegration })

    // Browsing Times
    const browsingTimeIntegration = new integrations.HttpLambdaIntegration('BrowsingTimeIntegration', browsingTimeFn)
    api.addRoutes({ path: '/browsing-times', methods: [apigwv2.HttpMethod.GET], integration: browsingTimeIntegration })
    api.addRoutes({ path: '/browsing-times', methods: [apigwv2.HttpMethod.POST], integration: browsingTimeIntegration })

    // Health Data
    const healthDataIntegration = new integrations.HttpLambdaIntegration('HealthDataIntegration', healthDataFn)
    api.addRoutes({ path: '/health-data', methods: [apigwv2.HttpMethod.GET], integration: healthDataIntegration })
    api.addRoutes({ path: '/health-data', methods: [apigwv2.HttpMethod.POST], integration: healthDataIntegration })

    // Activity Logs
    const activityLogIntegration = new integrations.HttpLambdaIntegration('ActivityLogIntegration', activityLogFn)
    api.addRoutes({ path: '/activity-logs', methods: [apigwv2.HttpMethod.GET], integration: activityLogIntegration })
    api.addRoutes({ path: '/activity-logs', methods: [apigwv2.HttpMethod.POST], integration: activityLogIntegration })

    // Situation Logs
    const situationLogIntegration = new integrations.HttpLambdaIntegration('SituationLogIntegration', situationLogFn)
    api.addRoutes({ path: '/situation-logs', methods: [apigwv2.HttpMethod.GET], integration: situationLogIntegration })
    api.addRoutes({ path: '/situation-logs', methods: [apigwv2.HttpMethod.POST], integration: situationLogIntegration })

    // Chat Sessions / Messages
    const chatIntegration = new integrations.HttpLambdaIntegration('ChatIntegration', chatFn)
    api.addRoutes({ path: '/chat-sessions', methods: [apigwv2.HttpMethod.GET], integration: chatIntegration })
    api.addRoutes({ path: '/chat-sessions', methods: [apigwv2.HttpMethod.POST], integration: chatIntegration })
    api.addRoutes({ path: '/chat-sessions/{id}', methods: [apigwv2.HttpMethod.PUT], integration: chatIntegration })
    api.addRoutes({ path: '/chat-sessions/{id}', methods: [apigwv2.HttpMethod.DELETE], integration: chatIntegration })
    api.addRoutes({ path: '/chat-sessions/{id}/messages', methods: [apigwv2.HttpMethod.GET], integration: chatIntegration })
    api.addRoutes({ path: '/chat-sessions/{id}/messages', methods: [apigwv2.HttpMethod.POST], integration: chatIntegration })

    // Messages / Dictionary
    api.addRoutes({ path: '/messages', methods: [apigwv2.HttpMethod.GET], integration: messageIntegration })
    api.addRoutes({ path: '/messages', methods: [apigwv2.HttpMethod.POST], integration: messageIntegration })
    api.addRoutes({ path: '/dictionary', methods: [apigwv2.HttpMethod.GET], integration: messageIntegration })
    api.addRoutes({ path: '/dictionary', methods: [apigwv2.HttpMethod.POST], integration: messageIntegration })
    api.addRoutes({ path: '/dictionary/{id}', methods: [apigwv2.HttpMethod.PUT], integration: messageIntegration })

    // Nutrition
    const nutritionIntegration = new integrations.HttpLambdaIntegration('NutritionIntegration', nutritionFn)
    api.addRoutes({ path: '/nutrition', methods: [apigwv2.HttpMethod.GET], integration: nutritionIntegration })
    api.addRoutes({ path: '/nutrition/{date}/{mealType}', methods: [apigwv2.HttpMethod.PUT], integration: nutritionIntegration })

    // Fitbit Data
    const fitbitDataIntegration = new integrations.HttpLambdaIntegration('FitbitDataIntegration', fitbitDataFn)
    api.addRoutes({ path: '/fitbit-data', methods: [apigwv2.HttpMethod.GET], integration: fitbitDataIntegration })
    api.addRoutes({ path: '/fitbit-data', methods: [apigwv2.HttpMethod.POST], integration: fitbitDataIntegration })

    // ---- Outputs ----
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.apiEndpoint,
      description: 'API Gateway endpoint URL',
    })

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    })

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    })
  }
}
