import { Storage } from "@google-cloud/storage";
import * as fs from "fs";
import path from 'path';
import dotenv from 'dotenv'

dotenv.config()

function buildStorageClient(): Storage {
  const projectId = process.env.PROJECT_ID;
  const serviceAccountJson = process.env.GCP_SERVICE_ACCOUNT_JSON;
  const clientEmail = process.env.GCP_CLIENT_EMAIL;
  const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, '\n');

  if (serviceAccountJson) {
    const parsedCredentials = JSON.parse(serviceAccountJson);
    return new Storage({
      projectId,
      credentials: {
        client_email: parsedCredentials.client_email,
        private_key: parsedCredentials.private_key,
      },
    });
  }

  if (clientEmail && privateKey) {
    return new Storage({
      projectId,
      credentials: {
        client_email: clientEmail,
        private_key: privateKey,
      },
    });
  }

  return new Storage({
    projectId,
  });
}

const storage = buildStorageClient();
console.log(process.env.PROJECT_ID, 'process.env.PROJECT_ID');
console.log(process.env.GCP_STORAGE_BUCKET, 'process.env.GCP_STORAGE_BUCKETs');
const bucketName =process.env.GCP_STORAGE_BUCKET;

export interface IGCPUploadParams {
  filePath: string;
  fileName: string;
  employeeId: string;
  category: string;
  type: string;
}

export interface IGCPUploadResult {
  success: boolean;
  fileUrl?: string;
  error?: string;
}

/**
 * Upload file to GCP Cloud Storage with organized folder structure
 */
export async function uploadFileToGCP(params: IGCPUploadParams): Promise<IGCPUploadResult> {
  try {
    const { filePath, fileName, employeeId, category, type } = params;

    // Determine folder name based on category and type
    const folderName = getFolderName(category, type);
    console.log(folderName, "folderName")
    // Create the full path in GCP: employeeId/folderName/fileName
    const gcpFilePath = `${employeeId}/${folderName}/${fileName}`;

    // Upload file to GCP
    const bucket = storage.bucket(bucketName || ``);
    console.log(bucket, "bucket---bucket")
    const file = bucket.file(gcpFilePath);
    console.log(file, "file---file")
    // Upload the file
    await file.save(fs.readFileSync(filePath), {
      metadata: {
        contentType: getContentType(fileName),
      },
    });

    // // Make the file publicly accessible
    // await file.makePublic();

    // Construct the public URL
    const fileUrl = `https://storage.googleapis.com/${bucketName}/${gcpFilePath}`;
    return {
      success: true,
      fileUrl,
    };

  } catch (error: any) {
    console.error('GCP Upload Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to upload file to GCP',
    };
  }
}

/**
 * Delete file from GCP Cloud Storage
 */
export async function deleteFileFromGCP(fileUrl: string): Promise<IGCPUploadResult> {
  try {
    // Extract file path from URL
    const urlParts = fileUrl.replace(`https://storage.googleapis.com/${bucketName}/`, '');

    const bucket = storage.bucket(bucketName || '');
    const file = bucket.file(urlParts);

    // Check if file exists before deleting
    const [exists] = await file.exists();
    if (!exists) {
      return {
        success: true, // File doesn't exist, consider deletion successful
        fileUrl: '',
      };
    }

    await file.delete();

    return {
      success: true,
      fileUrl: '',
    };

  } catch (error: any) {
    console.error('GCP Delete Error:', error);
    return {
      success: false,
      error: error.message || 'Failed to delete file from GCP',
    };
  }
}

/**
 * Get folder name based on category and type
 */
function getFolderName(category: string, type: string): string {
  switch (category) {
    case 'Timesheet':
      return 'TimesheetFile';
    case 'Tax':
      switch (type) {
        case 'Form16':
          return 'Form16';
        case 'Form12B':
          return 'Form12B';
        case 'Form12BB':
          return 'Form12BB';
        case 'TaxProof':
          return 'TaxProof';
        default:
          return 'Tax';
      }
    case 'EmployeeLifecycle':
      switch (type) {
        case 'OfferLetter':
          return 'OfferLetter';
        case 'HikeLetter':
          return 'HikeLetter';
        default:
          return 'EmployeeLifecycle';
      }
    case 'Certification':
      // Handle Academic, Experience, and GovernmentId document types
      switch (type) {
        case 'Academic':
          return 'Academic';
        case 'Experience':
          return 'Experience';
        case 'GovernmentId':
          return 'GovernmentId';
        default:
          return 'Certificate';
      }
    case 'Payroll':
      return 'Payroll';
    default:
      return category;
  }
}

/**
 * Get content type based on file extension
 */
function getContentType(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();

  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.doc':
      return 'application/msword';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
} 
