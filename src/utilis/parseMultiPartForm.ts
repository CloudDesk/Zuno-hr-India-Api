import { FastifyRequest } from 'fastify';
import { MultipartFile } from '@fastify/multipart';

export async function parseMultipartForm(request: FastifyRequest) {
    const parts = request.parts();
    const body: Record<string, any> = {};
    const files: MultipartFile[] = [];

    for await (const part of parts) {
        if (part.type === 'file') {
            // It's a file part
            files.push(part as MultipartFile);
        } else {
            // It's a field part
            body[part.fieldname] = part.value;
        }
    }

    return { body, files };
}


import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';

export async function saveMultipartFile(filePart: any, targetPath: string) {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await pipeline(filePart.file, fs.createWriteStream(targetPath));
}