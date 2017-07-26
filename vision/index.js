'use strict';
// TNT-OCR Lambda function v1
// Google Vision API https://googlecloudplatform.github.io/google-cloud-node/#/docs/vision/0.11.0/vision
const vision = require('@google-cloud/vision')({
  projectId: process.env.PROJECT_ID,
  keyFilename: process.env.KEY_NAME
});
const AWS = require('aws-sdk');
const s3 = new AWS.S3({
  apiVersion: '2006-03-01', // lock in specific version of the SDK
  signatureVersion: 'v4', // S3 requires the "v4" signatureVersion to enable KMS server side encryption
});
const Lambda = new AWS.Lambda({ apiVersion: '2015-03-31' });
const dynamo = new AWS.DynamoDB.DocumentClient();
const bucketName = process.env.IMAGE_BUCKET_NAME;
const dynamoTable = process.env.TABLE_NAME;
const translateLambdaFunctionName = process.env.TRANSLATE_LAMBDA;
const NLPLambdaFunctionName = process.env.NLP_LAMBDA;

const getUIDFromS3Key = (key) => {
  const keyArray = key.split('/');
  return keyArray[keyArray.length - 1].split('.')[0];
};

const getOCR = (event, callback) => {
  const imageKey = event.Records[0].s3.object.key;
  if (imageKey.includes('.jpg') || event.key.include('.png')) {
    const s3Params = {
      Bucket: bucketName,
      Key: imageKey
    };
    const uid = getUIDFromS3Key(imageKey);

    console.log(s3Params);
    s3.getObject(s3Params).promise()
    .then((data) => {
      console.log(data);
      vision.detectText(data.Body, function(err, detections) {
        if (err) {
          console.log(err);
        } else {

          // For GC Translate Lambda
          const translateData = {
            uid,
            ocr: detections
          };

          const translatePayload = {
              operation: 'TRANSLATE_OCR',
              data: translateData,
          };

          const translateParams = {
              FunctionName: translateLambdaFunctionName,
              InvocationType: 'Event',
              Payload: new Buffer(JSON.stringify(translatePayload)),
          };

          Lambda.invoke(translateParams).promise();

          // For GC NLP Lambda
          const nlpData = {
            uid,
            ocr: detections
          };

          const nlpPayload = {
              operation: 'NLP_OCR',
              data: nlpData,
          };

          const nlpParams = {
              FunctionName: NLPLambdaFunctionName,
              InvocationType: 'Event',
              Payload: new Buffer(JSON.stringify(nlpPayload)),
          };

          Lambda.invoke(nlpParams).promise();

          // save OCR results in image database (dynamodb)
          return dynamo.update({
            Key: { uid },
            TableName: dynamoTable,
            ReturnValues: 'ALL_NEW',
            ExpressionAttributeNames: { "#DK": 'ocr' },
            ExpressionAttributeValues: { ":d": detections },
            UpdateExpression: 'SET #DK = :d'
          }).promise()
        }

      });
    })
    .then(() => callback(null, { success: true }))
    .catch(err => callback(err));
  } else {
    console.log('new S3 object is not an image! No OCR for you');
  }
};

// callback(err, result);
exports.handler = (event, context, callback) => {
  try {
      getOCR(event, callback);
  } catch (err) {
      callback(err);
  }
};
