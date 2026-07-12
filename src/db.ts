import Dexie, { type EntityTable } from 'dexie';

export interface Project {
  id?: number;
  title: string;
  timestamp: number;
  isFavorite: boolean;
}

export interface ImageRecord {
  id?: number;
  projectId: number;
  rawImageBlob: Blob;
  translatedImageBlob?: Blob;
}

export interface TextBlock {
  id?: number;
  imageId: number;
  originalText: string;
  translatedText: string;
  posX: number;
  posY: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  color: string;
}

const db = new Dexie('KitesDatabase') as Dexie & {
  projects: EntityTable<Project, 'id'>;
  images: EntityTable<ImageRecord, 'id'>;
  textBlocks: EntityTable<TextBlock, 'id'>;
};

db.version(1).stores({
  projects: '++id, title, timestamp, isFavorite',
  images: '++id, projectId',
  textBlocks: '++id, imageId'
});

// Cascading Delete Hook
db.projects.hook('deleting', function(projectId) {
  // Use a transaction to ensure atomic deletion
  return db.transaction('rw', db.images, db.textBlocks, async () => {
    const images = await db.images.where({ projectId }).toArray();
    for (const img of images) {
      if (img.id) {
        await db.textBlocks.where({ imageId: img.id }).delete();
      }
    }
    await db.images.where({ projectId }).delete();
  });
});

export { db };
