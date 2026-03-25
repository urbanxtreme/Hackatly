# API Test Cases

> Replace `<token>` with a valid JWT from `/register` or `/login`.

---

## 1. Register

**POST** `http://localhost:3000/register`

```json
{
  "username": "testuser",
  "password": "pass123",
  "email": "emailid@gmail.com"
}
```

---

## 2. Login

**POST** `http://localhost:3000/login`

```json
{
  "username": "testuser",
  "password": "pass123"
}
```

---

---

## 3. Initialize Map (Full Matrix)

**POST** `http://localhost:3000/init`

**Headers:** `Authorization: Bearer <token>`

> **Note:** Typically used only during initial signup or for full resets.

```json
{
  "map": [
    [0, 0, 1, 0],
    [0, 1, 0, 0],
    [0, 0, 0, 1],
    [0, 0, 0, 0]
  ]
}
```

---

## 4. Update Map (Sparse Obstacles - Preferred)

**PUT** `http://localhost:3000/map`

**Headers:** `Authorization: Bearer <token>`

> **Note:** More efficient for partial updates. Send only the `[x, y]` coordinates of obstacles.

```json
{
  "obstacles": [
    [0, 2],
    [1, 1],
    [2, 3]
  ]
}
```

---

## 5. Get Map

**GET** `http://localhost:3000/map`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 5. Create Task — High Priority

**POST** `http://localhost:3000/task`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "task_id": "T1",
  "get_coordinate": [0, 0],
  "put_coordinate": [3, 3],
  "priority": "high"
}
```

> Task is automatically queued and executed by the background worker.

---

## 6. Create Task — Medium Priority

**POST** `http://localhost:3000/task`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "task_id": "T2",
  "get_coordinate": [0, 1],
  "put_coordinate": [2, 2],
  "priority": "medium"
}
```

---

## 7. Create Task — Low Priority (Conflicts with T1)

**POST** `http://localhost:3000/task`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "task_id": "T3",
  "get_coordinate": [3, 3],
  "put_coordinate": [0, 0],
  "priority": "low"
}
```

**Expected:** T1 and T3 have conflicting positions (T1 goes to `[3,3]`, T3 picks from `[3,3]`), so deadlock detection flags a cycle. T3 (low priority) gets paused while T1 (high) and T2 (medium) get paths computed automatically.

---

## 8. List Tasks

**GET** `http://localhost:3000/tasks`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 9. Add Robot

**POST** `http://localhost:3000/robots`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "name": "Bot1",
  "state": "idle",
  "priority": "high",
  "x": 0,
  "y": 0,
  "current_task": "none",
  "battery": 100
}
```

---

## 10. Get All Robots

**GET** `http://localhost:3000/robots`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 11. Get Robot by ID

**GET** `http://localhost:3000/robots/1`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 12. Update Robot State

**PATCH** `http://localhost:3000/robots/1/state`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "state": "active"
}
```

---

## 13. Update Robot Priority

**PATCH** `http://localhost:3000/robots/1/priority`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "priority": "high"
}
```

---

## 14. Get Logs

**GET** `http://localhost:3000/logs`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 15. Add Log

**POST** `http://localhost:3000/logs`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "bot_id": 1,
  "task": "Manual test log"
}
```

---

## 16. Unauthorized Access (No Token)

**GET** `http://localhost:3000/robots`

No headers, no body.

**Expected:** `401 Unauthorized` — `"Authorization header is required"`

---

## 17. Get Task Logs

**GET** `http://localhost:3000/tasks/log`

**Headers:** `Authorization: Bearer <token>`

No request body.

---

## 18. Update Robot Battery

**PUT** `http://localhost:3000/robots/1/battery`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "battery": 85
}
```

---

## 19. Update Analytics

**POST** `http://localhost:3000/analytics`

**Headers:** `Authorization: Bearer <token>`

```json
{
  "total_efficiency": 0.92,
  "active_time": 150.5,
  "wait_time": 12.0,
  "jam_time": 3.5
}
```

---

## 20. Get Analytics Summary

**GET** `http://localhost:3000/analytics`

**Headers:** `Authorization: Bearer <token>`

No request body.
