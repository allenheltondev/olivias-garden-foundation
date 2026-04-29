import { cleanupExpiredStoreProductImages } from '../services/store-images.mjs';

export const handler = async () => cleanupExpiredStoreProductImages(250);
