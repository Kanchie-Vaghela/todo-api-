# todo-api

A REST API built with Node.js, Express, PostgreSQL, and Redis. The goal wasn't the app itself — it was understanding the patterns underneath it before applying them in more meaningful projects.

---

## What I Built

A backend-only TODO API with five endpoints — create, read all, read one, toggle completion, delete. No frontend, no ORM, no abstraction layers. Just Express routing directly to PostgreSQL queries, tested with Postman.

After the core API worked, I layered Redis caching on top of the `GET /todos` endpoint and measured the difference.

---

## Learnings

### PostgreSQL + `pg` library

**Why raw SQL instead of an ORM like Prisma or Sequelize?**
ORMs hide what's happening at the database level. Writing SQL directly forced me to understand what's actually being sent to the database. ORMs are a productivity tool for people who already understand SQL — not a shortcut around learning it.

**Connection pooling**
The `pg` library provides two options: `Client` (single connection) and `Pool` (managed set of reusable connections). Opening a new database connection per request is expensive — hundreds of milliseconds of overhead. A pool keeps connections warm and reuses them. I used `Pool` throughout.

One subtle bug to know: when you call `pool.connect()` manually, you must call `release()` after, or that connection is held forever and eventually the pool starves. `pool.query()` handles this automatically — prefer it unless you need a transaction.

**Parameterized queries**
```js
// Never do this
pool.query(`SELECT * FROM todos WHERE id = ${id}`)

// Always do this
pool.query('SELECT * FROM todos WHERE id = $1', [id])
```
The `$1` placeholder tells `pg` to escape the value safely. The first version is a SQL injection vulnerability — an attacker can pass `id = 1; DROP TABLE todos` and it executes. The second version treats the input as data, never as SQL.

**`RETURNING *`**
After an INSERT, UPDATE, or DELETE, PostgreSQL returns nothing by default. Adding `RETURNING *` returns the affected row in the same operation, avoiding a second round-trip query just to fetch what you just wrote.

---

### Redis + Cache-Aside Pattern

**How it works**
1. Request hits `GET /todos`
2. Check Redis — if data exists (cache hit), return it immediately. No DB query.
3. If not (cache miss) — query PostgreSQL, store the result in Redis with a 60s TTL, return it
4. On any write (POST, PATCH, DELETE) — delete the Redis key so the next GET fetches fresh data

**Why delete the cache on writes instead of updating it?**
Overwriting the cache with new data on every write introduces race conditions — two simultaneous writes could result in stale data being cached. Deleting the key and letting the next read repopulate it is simpler and always consistent.

**TTL as a safety net**
Even if cache invalidation somehow fails, the 60s TTL guarantees the stale data expires on its own. TTL is not the primary invalidation strategy — it's the fallback.

**The gap I'm aware of**
If Redis goes down, the current implementation returns a 500 error. In production, the right behavior is to fall through to the database on cache failure — Redis being down should degrade performance, not break the app.

---

## Benchmark Results

> Tested with 2000 rows, 5 requests per scenario, PostgreSQL and Redis running locally via Docker

| Scenario | Response Time |
|---|---|
| Direct PostgreSQL query (no cache) | ~100ms |
| Redis cache miss (first request after invalidation) | ~200-300ms |
| Redis cache hit (subsequent requests) | ~10-14ms |

**Why is cache miss slower than a direct query?**
On a miss, the app does both — queries PostgreSQL and writes to Redis before responding. The extra Redis write adds overhead compared to a plain DB query.

**What the numbers actually mean**
The cache hit result (~10ms) is the most reliable number. The miss/baseline gap has noise — localhost response times fluctuate based on connection pool warmup, machine load, and query plan caching inside PostgreSQL itself. The pattern is what matters: cache hit is significantly faster than a DB query, and the tradeoff is a slightly slower first request.

---

## What Comes Next

These same patterns — PostgreSQL queries with `pg`, Redis cache-aside with invalidation on writes — apply directly to the URL shortener I'm building next. 
