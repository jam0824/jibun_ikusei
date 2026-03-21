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
