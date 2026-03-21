#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { JibunIkuseiStack } from '../lib/jibun-ikusei-stack'

const app = new cdk.App()
new JibunIkuseiStack(app, 'JibunIkuseiStack', {
  env: { region: 'ap-northeast-1' },
})
