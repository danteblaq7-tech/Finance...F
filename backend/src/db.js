import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  decimalNumbers: true, // DECIMAL columns come back as numbers, not strings
  dateStrings: true, // DATE/DATETIME as 'YYYY-MM-DD HH:MM:SS' wall-clock strings
  typeCast(field, next) {
    // TINYINT(1) columns -> real booleans
    if (field.type === 'TINY' && field.length === 1) return field.string() === '1';
    return next();
  },
});

export const query = async (sql, params = []) => {
  const [rows] = await pool.query(sql, params);
  return rows;
};

export const queryOne = async (sql, params = []) => (await query(sql, params))[0] ?? null;

/** Run fn(conn) inside a transaction. */
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
