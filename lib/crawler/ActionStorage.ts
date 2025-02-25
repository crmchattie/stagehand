import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { UserAction } from './LLMActionAnalyzer';
import { LogLine } from "../../types/log";
import { v4 as uuidv4 } from 'uuid';

// Define schema for Drizzle ORM
const websites = pgTable('websites', {
  id: serial('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title'),
  last_crawled: timestamp('last_crawled', { withTimezone: true }).defaultNow(),
}, (table) => {
  return {
    urlIdx: uniqueIndex('url_idx').on(table.url),
  };
});

// const userActions = pgTable('user_actions', {
//   id: uuid('id').primaryKey(),
//   website_id: serial('website_id').references(() => websites.id),
//   type: text('type').notNull(),
//   name: text('name').notNull(),
//   description: text('description'),
//   confidence: doublePrecision('confidence').notNull(),
//   created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
// });

// const actionElements = pgTable('action_elements', {
//   id: serial('id').primaryKey(),
//   action_id: uuid('action_id').references(() => userActions.id),
//   selector: text('selector').notNull(),
//   element_type: text('element_type').notNull(),
//   attributes: jsonb('attributes'),
//   text: text('text'),
//   position: jsonb('position'),
// });

// This interface would be implemented by your vector database client
export interface VectorDBClient {
  storeVector(id: string, vector: number[], metadata: Record<string, unknown>): Promise<void>;
  searchSimilar(vector: number[], limit?: number): Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>;
}

// Define a type for the action result
interface ActionResult {
  id: string;
  type: string;
  name: string;
  description: string;
  confidence: number;
  url: string;
  elements: Array<{
    selector: string;
    type: string;
    attributes: Record<string, unknown>;
    text: string;
    position: { x: number; y: number };
  }>;
}

export class ActionStorage {
  private db: ReturnType<typeof drizzle>;
  private pool: Pool;
  private vectorDB: VectorDBClient;
  private logger: (logLine: LogLine) => void;
  
  constructor(
    pgConfig: {
      host?: string;
      port?: number;
      database: string;
      user: string;
      password: string;
    }, 
    vectorDB: VectorDBClient,
    logger: (logLine: LogLine) => void
  ) {
    // Create a PostgreSQL connection pool
    this.pool = new Pool({
      host: pgConfig.host || 'localhost',
      port: pgConfig.port || 5432,
      database: pgConfig.database,
      user: pgConfig.user,
      password: pgConfig.password
    });
    
    this.db = drizzle(this.pool);
    this.vectorDB = vectorDB;
    this.logger = logger;
  }
  
  /**
   * Initialize database tables if they don't exist
   */
  public async initialize(): Promise<void> {
    try {
      // With Drizzle, you typically use migrations or the schema definition above
      // Tables are created using drizzle-kit, but we can execute raw SQL if needed
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS websites (
          id SERIAL PRIMARY KEY,
          url TEXT NOT NULL,
          title TEXT,
          last_crawled TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(url)
        );
        
        CREATE TABLE IF NOT EXISTS user_actions (
          id UUID PRIMARY KEY,
          website_id INTEGER REFERENCES websites(id),
          type TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          confidence FLOAT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        
        CREATE TABLE IF NOT EXISTS action_elements (
          id SERIAL PRIMARY KEY,
          action_id UUID REFERENCES user_actions(id),
          selector TEXT NOT NULL,
          element_type TEXT NOT NULL,
          attributes JSONB,
          text TEXT,
          position JSONB
        );
      `);
      
      this.logger({
        category: "action-storage",
        message: "Database tables initialized successfully",
        level: 1,
      });
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error initializing database tables",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          trace: {
            value: error.stack,
            type: "string"
          }
        }
      });
      throw error;
    }
  }
  
  /**
   * Store user actions in PostgreSQL and vector database
   */
  public async storeActions(actions: UserAction[]): Promise<void> {
    if (!actions.length) return;
    
    try {
      // Use a transaction
      await this.db.transaction(async (tx) => {
        for (const action of actions) {
          // Get or create website record
          const [websiteResult] = await tx
            .insert(websites)
            .values({ url: action.url })
            .onConflictDoUpdate({
              target: websites.url,
              set: { [websites.last_crawled.name]: sql`CURRENT_TIMESTAMP` }
            })
            .returning({ id: websites.id });
          
          const websiteId = websiteResult.id;
          
          // Create action record
          const actionId = uuidv4();
          await tx.execute(sql`
            INSERT INTO user_actions (id, website_id, type, name, description, confidence)
            VALUES (${actionId}, ${websiteId}, ${action.type}, ${action.name}, ${action.description}, ${action.confidence})
          `);
          
          // Store elements
          for (const element of action.elements) {
            await tx.execute(sql`
              INSERT INTO action_elements (action_id, selector, element_type, attributes, text, position)
              VALUES (${actionId}, ${element.selector}, ${element.type}, ${JSON.stringify(element.attributes || {})}, ${element.text}, ${JSON.stringify(element.position)})
            `);
          }
          
          // Store in vector database
          await this.storeActionVector(actionId, action);
        }
      });
      
      this.logger({
        category: "action-storage",
        message: `Stored ${actions.length} user actions in database`,
        level: 1,
      });
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error storing user actions",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          trace: {
            value: error.stack,
            type: "string"
          }
        }
      });
      throw error;
    }
  }
  
  /**
   * Store action in vector database for semantic search
   */
  private async storeActionVector(actionId: string, action: UserAction): Promise<void> {
    try {
      // This is a placeholder - you would use your LLM to generate the embedding
      // const embedding = await this.generateEmbedding(action);
      
      // For demonstration, we'll use a dummy vector
      const dummyVector = new Array(1536).fill(0).map(() => Math.random());
      
      // Store in vector database with metadata
      await this.vectorDB.storeVector(actionId, dummyVector, {
        type: action.type,
        name: action.name,
        description: action.description,
        url: action.url
      });
      
      this.logger({
        category: "action-storage",
        message: `Stored vector for action ${action.name} (${actionId})`,
        level: 1,
      });
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error storing action vector",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          actionId: {
            value: actionId,
            type: "string"
          }
        }
      });
    }
  }
  
  /**
   * Search for similar actions in the vector database
   */
  public async findSimilarActions(query: string, limit: number = 10): Promise<ActionResult[]> {
    try {
      // This is a placeholder - you would use your LLM to generate the embedding
      // const queryEmbedding = await this.generateEmbedding(query);
      
      // For demonstration, we'll use a dummy vector
      const dummyVector = new Array(1536).fill(0).map(() => Math.random());
      
      // Search vector database
      const results = await this.vectorDB.searchSimilar(dummyVector, limit);
      
      // Fetch full action details from PostgreSQL
      const actionIds = results.map(result => result.id);
      
      if (actionIds.length === 0) return [];
      
      // Using Drizzle to query the database
      const actions = await this.db.execute(sql`
        SELECT 
          ua.id, ua.type, ua.name, ua.description, ua.confidence, 
          w.url, 
          json_agg(
            json_build_object(
              'selector', ae.selector,
              'type', ae.element_type,
              'attributes', ae.attributes,
              'text', ae.text,
              'position', ae.position
            )
          ) as elements
        FROM user_actions ua
        JOIN websites w ON ua.website_id = w.id
        JOIN action_elements ae ON ua.id = ae.action_id
        WHERE ua.id = ANY(${actionIds})
        GROUP BY ua.id, w.url
      `);
      
      return actions as unknown as ActionResult[];
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error finding similar actions",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          query: {
            value: query,
            type: "string"
          }
        }
      });
      return [];
    }
  }
  
  /**
   * Get all actions for a specific URL
   */
  public async getActionsByUrl(url: string): Promise<ActionResult[]> {
    try {
      const actions = await this.db.execute(sql`
        SELECT 
          ua.id, ua.type, ua.name, ua.description, ua.confidence, 
          w.url, 
          json_agg(
            json_build_object(
              'selector', ae.selector,
              'type', ae.element_type,
              'attributes', ae.attributes,
              'text', ae.text,
              'position', ae.position
            )
          ) as elements
        FROM user_actions ua
        JOIN websites w ON ua.website_id = w.id
        JOIN action_elements ae ON ua.id = ae.action_id
        WHERE w.url = ${url}
        GROUP BY ua.id, w.url
      `);
      
      return actions as unknown as ActionResult[];
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error getting actions by URL",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          url: {
            value: url,
            type: "string"
          }
        }
      });
      return [];
    }
  }
  
  /**
   * Get actions by type
   */
  public async getActionsByType(type: string, limit: number = 10): Promise<ActionResult[]> {
    try {
      const actions = await this.db.execute(sql`
        SELECT 
          ua.id, ua.type, ua.name, ua.description, ua.confidence, 
          w.url, 
          json_agg(
            json_build_object(
              'selector', ae.selector,
              'type', ae.element_type,
              'attributes', ae.attributes,
              'text', ae.text,
              'position', ae.position
            )
          ) as elements
        FROM user_actions ua
        JOIN websites w ON ua.website_id = w.id
        JOIN action_elements ae ON ua.id = ae.action_id
        WHERE ua.type = ${type}
        GROUP BY ua.id, w.url
        LIMIT ${limit}
      `);
      
      return actions as unknown as ActionResult[];
    } catch (error) {
      this.logger({
        category: "action-storage",
        message: "Error getting actions by type",
        level: 1,
        auxiliary: {
          error: {
            value: error.message,
            type: "string"
          },
          type: {
            value: type,
            type: "string"
          }
        }
      });
      return [];
    }
  }
  
  /**
   * Close database connections
   */
  public async close(): Promise<void> {
    await this.pool.end();
  }
} 