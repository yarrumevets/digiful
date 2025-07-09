import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
// import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_BUCKET = "" + process.env.S3_BUCKET;
const S3_ACCESS_KEY = "" + process.env.S3_ACCESS_KEY;
const S3_SECRET_ACCESS_KEY = "" + process.env.S3_SECRET_ACCESS_KEY;
const S3_REGION = "" + process.env.S3_REGION;

const getS3Client = (
  region: string,
  s3AccessKeyId: string,
  s3SecretAccessKey: string,
) => {
  const s3Client = new S3Client({
    region: region,
    credentials: {
      accessKeyId: s3AccessKeyId,
      secretAccessKey: s3SecretAccessKey,
    },
  });
  return s3Client;
};

// // Get a presigned URL for a specific file in S3.
// const getS3ProductSignedUrl = async (
//   s3AccessKeyId: string,
//   s3SecretAccessKey: string,
//   bucket: string,
//   region: string,
//   filePath: string,
//   expiryMinutes: number,
// ) => {
//   const s3Client = getS3Client(region, s3AccessKeyId, s3SecretAccessKey);

//   const params = {
//     Bucket: bucket,
//     Key: filePath,
//     Expires: expiryMinutes * 60,
//   };
//   const command = new GetObjectCommand(params);
//   const digitalAssetUrl = await getSignedUrl(s3Client, command, {
//     expiresIn: 3600,
//   });
//   return digitalAssetUrl;
// };

const s3AddProduct = async (
  s3AccessKeyId: string,
  s3SecretAccessKey: string,
  bucket: string,
  region: string,
  title: string,
  file: Buffer | Uint8Array | Blob | string | ReadableStream<any>,
  fileType: string,
  fileName: string,
) => {
  const s3Client = getS3Client(region, s3AccessKeyId, s3SecretAccessKey);
  try {
    // Write
    const s3AddProductResponse = await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileName,
        Body: file,
        ContentType: fileType,
        Metadata: {
          title: title,
        },
      }),
    );
    return { ETag: s3AddProductResponse.ETag, success: true };
  } catch (err) {
    console.error("S3 failed adding new product:", err);
    return { success: false };
  }
};

const s3AddProductWithAppCreds = async (
  title: string,
  file: Buffer | Uint8Array | Blob | string | ReadableStream<any>,
  fileType: string,
  fileName: string,
) => {
  const s3Client = getS3Client(S3_REGION, S3_ACCESS_KEY, S3_SECRET_ACCESS_KEY);
  try {
    // Write
    const s3AddProductResponse = await s3Client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileName,
        Body: file,
        ContentType: fileType,
        Metadata: {
          title: title,
        },
      }),
    );
    return { ETag: s3AddProductResponse.ETag, success: true };
  } catch (err) {
    console.error("S3 failed adding new product:", err);
    return { success: false };
  }
};

// Test user's permissions.
const s3CredsTest = async (
  s3AccessKeyId: string,
  s3SecretAccessKey: string,
  bucket: string,
  region: string,
) => {
  const s3Client = getS3Client(region, s3AccessKeyId, s3SecretAccessKey);
  const testKey = "digiful-test-file_delete-me.txt";
  const testContent =
    "This file was created by digiful in order to test your S3 credentioals. You can delete this file.";
  try {
    // Write
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: testKey,
        Body: testContent,
      }),
    );
    // Read
    await s3Client.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: testKey,
      }),
    );
    // // Give a delay to allow time to verify in S3.
    // await new Promise((r) => setTimeout(r, 6000));
    // Delete
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: bucket,
        Key: testKey,
      }),
    );
    return true;
  } catch (err) {
    console.error("S3 permission test failed:", err);
    return false;
  }
};

export { s3CredsTest, s3AddProduct, s3AddProductWithAppCreds };
