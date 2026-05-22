const express = require('express');
const router = express.Router();
const pool = require('./db');
const redis = require('./cache');

const CACHE_KEY = 'todos:all';
const CACHE_TTL = 60; // seconds

// POST /todos — create a new todo
router.post('/', async (req, res) => {
  const { title, description } = req.body;

  if (!title || title.trim() === '') {
    return res.status(400).json({ error: 'Title is required' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO todos (title, description) VALUES ($1, $2) RETURNING *',
      [title.trim(), description || null]
    );

    await redis.del(CACHE_KEY); // invalidate cache
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create todo' });
  }
});

// GET /todos — get all todos (with Redis cache)
router.get('/', async (req, res) => {
  try {
    const cached = await redis.get(CACHE_KEY);
    if (cached) {
      console.log('Cache HIT');
      return res.json(JSON.parse(cached));
    }
    console.log('Cache MISS — querying PostgreSQL');
    const result = await pool.query(
      'SELECT * FROM todos ORDER BY created_at DESC'
    );
    await redis.setex(CACHE_KEY, CACHE_TTL, JSON.stringify(result.rows));
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch todos' });
  }
});

// GET /todos/:id — get one todo (no cache needed for single items here)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'SELECT * FROM todos WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch todo' });
  }
});

// PATCH /todos/:id — toggle completed status
router.patch('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const existing = await pool.query(
      'SELECT * FROM todos WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    const result = await pool.query(
      'UPDATE todos SET completed = NOT completed WHERE id = $1 RETURNING *',
      [id]
    );

    await redis.del(CACHE_KEY); // invalidate cache
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update todo' });
  }
});

// DELETE /todos/:id — delete a todo
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM todos WHERE id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Todo not found' });
    }

    await redis.del(CACHE_KEY); // invalidate cache
    res.json({ message: 'Todo deleted', todo: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete todo' });
  }
});

module.exports = router;