import Dexie, { type EntityTable } from 'dexie';

export interface Project {
  id?: number;
  title: string;
  timestamp: number;
  isFavorite: boolean;
  status?: 'queued' | 'downloading' | 'processing' | 'completed' | 'error';
  srcUrl?: string;
  mockTranslatedBlocks?: any[];
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

// Increment version or keep 1 since we are just adding an index and this is local MVP,
// Dexie allows adding indices by simply changing the string if version is updated.
// Let's increment version to 2 to safely apply the schema change.
db.version(2).stores({
  projects: '++id, title, timestamp, isFavorite, status',
  images: '++id, projectId',
  textBlocks: '++id, imageId'
});

// Cascading Delete Hook
db.projects.hook('deleting', function(projectId) {
  // Use a transaction to ensure atomic deletion
  return db.transaction('rw', db.images, db.textBlocks, async () => {
    try {
      console.log(`[Database] Triggering cascading delete for Project ID: ${projectId}`);
      const images = await db.images.where({ projectId }).toArray();
      for (const img of images) {
        if (img.id) {
          await db.textBlocks.where({ imageId: img.id }).delete();
        }
      }
      await db.images.where({ projectId }).delete();
      console.log(`[Database] Cascading delete complete for Project ID: ${projectId}`);
    } catch (error) {
      console.error(`[Database] Failed cascading delete for Project ID: ${projectId}`, error);
      throw error;
    }
  });
});

export { db };
