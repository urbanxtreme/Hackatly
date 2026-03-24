package main

import (
	"database/sql"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

func InitMapHandler(c *gin.Context) {
	var req struct {
		Map [][]int `json:"map" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}
	InitMap(req.Map)
	InitReservations()
	c.JSON(http.StatusOK, gin.H{"status": "map initialized"})
}

func GetMapHandler(c *gin.Context) {
	grid := GetMap()
	if grid == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "map not initialized"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"map": grid})
}

func CreateTaskHandler(c *gin.Context) {
	var req struct {
		TaskID        string `json:"task_id" binding:"required"`
		GetCoordinate []int  `json:"get_coordinate" binding:"required"`
		PutCoordinate []int  `json:"put_coordinate" binding:"required"`
		Priority      string `json:"priority"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}
	if len(req.GetCoordinate) != 2 || len(req.PutCoordinate) != 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Coordinates must be [x, y]"})
		return
	}
	if req.Priority == "" {
		req.Priority = "medium"
	}

	task := Task{
		TaskID:    req.TaskID,
		GetX:      req.GetCoordinate[0],
		GetY:      req.GetCoordinate[1],
		PutX:      req.PutCoordinate[0],
		PutY:      req.PutCoordinate[1],
		Priority:  req.Priority,
		Status:    "pending",
		CreatedAt: time.Now(),
	}

	_, err := DB.Exec(
		"INSERT INTO tasks (task_id, get_x, get_y, put_x, put_y, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
		task.TaskID, task.GetX, task.GetY, task.PutX, task.PutY, task.Priority, task.Status,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	PushTask(task)

	c.JSON(http.StatusCreated, gin.H{"status": "task added", "task_id": task.TaskID})
}

func GetTasksHandler(c *gin.Context) {
	rows, err := DB.Query("SELECT task_id, get_x, get_y, put_x, put_y, priority, status, created_at FROM tasks ORDER BY created_at DESC")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	var tasks []Task
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.TaskID, &t.GetX, &t.GetY, &t.PutX, &t.PutY, &t.Priority, &t.Status, &t.CreatedAt); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		tasks = append(tasks, t)
	}
	c.JSON(http.StatusOK, tasks)
}

func CompleteTaskHandler(c *gin.Context) {
	taskID := c.Param("id")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task ID is required"})
		return
	}

	// Idempotent update: set status to completed
	result, err := DB.Exec("UPDATE tasks SET status = 'completed' WHERE task_id = ?", taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		var status string
		err := DB.QueryRow("SELECT status FROM tasks WHERE task_id = ?", taskID).Scan(&status)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
			return
		}
		if status == "completed" {
			c.JSON(http.StatusOK, gin.H{"status": "task already completed", "task_id": taskID})
			return
		}
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "task completed", "task_id": taskID})
}

func DeleteTaskHandler(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task ID is required"})
		return
	}

	if err := DeleteTask(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Task deleted successfully"})
}

func StartTaskWorker() {
	go func() {
		log.Println("[TaskWorker] Background task worker started")
		for {
			<-TaskQueue.notify
			processQueuedTasks()
		}
	}()
}

func processQueuedTasks() {
	// Drain strictly new tasks from memory queue first
	_ = DrainTasks()
	
	// Fetch ALL uncompleted tasks from DB to get a global picture
	rows, err := DB.Query("SELECT task_id, get_x, get_y, put_x, put_y, priority, status, created_at FROM tasks WHERE status IN ('pending', 'in_progress', 'waiting')")
	if err != nil {
		log.Printf("[TaskWorker] DB error: %v\n", err)
		return
	}
	defer rows.Close()

	var allActiveTasks []Task
	for rows.Next() {
		var t Task
		if err := rows.Scan(&t.TaskID, &t.GetX, &t.GetY, &t.PutX, &t.PutY, &t.Priority, &t.Status, &t.CreatedAt); err == nil {
			allActiveTasks = append(allActiveTasks, t)
		}
	}

	if len(allActiveTasks) == 0 {
		return
	}

	log.Printf("[TaskWorker] Processing %d active task(s) for global deadlock check...\n", len(allActiveTasks))

	// Detect cycles across all active tasks (pending + in_progress)
	cycles := CheckDeadlock(allActiveTasks)

	var resolution DeadlockResolution
	if len(cycles) > 0 {
		resolution = ResolveDeadlock(allActiveTasks, cycles)
		// Update statuses in DB for tasks that need to wait
		for _, t := range resolution.ReorderedTasks {
			if t.Status == "waiting" {
				DB.Exec("UPDATE tasks SET status = 'waiting' WHERE task_id = ?", t.TaskID)
			}
		}
		allActiveTasks = resolution.ReorderedTasks
		log.Printf("[TaskWorker] Deadlock resolved, paused tasks: %v\n", resolution.PausedTaskIDs)
	}

	// Always refresh reservations at the start of a batch
	InitReservations()

	for _, task := range allActiveTasks {
		// If task is already in progress, skip path planning for now.
		// The simulation is responsible for moving it along its existing path.
		if task.Status == "in_progress" {
			continue
		}

		// If task was paused by deadlock resolution, mark it and skip planning for now
		if task.Status == "waiting" {
			log.Printf("[TaskWorker] Task %s paused due to deadlock resolution\n", task.TaskID)
			DB.Exec("UPDATE tasks SET status = 'waiting' WHERE task_id = ?", task.TaskID)
			// Return to memory queue to re-check later
			PushTask(task)
			continue
		}

		// 3. Plan path for pending/waiting tasks that are now clear to move
		pickupPath, err := CooperativeAStar(task.GetX, task.GetY, task.GetX, task.GetY)
		if err != nil {
			pickupPath = []PathStep{{X: task.GetX, Y: task.GetY, T: 0}}
		}

		deliveryPath, err := CooperativeAStar(task.GetX, task.GetY, task.PutX, task.PutY)
		if err != nil {
			log.Printf("[TaskWorker] Task %s: no delivery path found: %v\n", task.TaskID, err)
			DB.Exec("UPDATE tasks SET status = 'failed' WHERE task_id = ?", task.TaskID)
			continue
		}

		// Commit reservation
		Reservations.ReservePath(deliveryPath)

		// Mark as in-progress in DB so simulation picks it up
		DB.Exec("UPDATE tasks SET status = 'in_progress' WHERE task_id = ?", task.TaskID)

		log.Printf("[TaskWorker] Task %s: pickup path (%d steps), delivery path (%d steps) reserved\n", 
			task.TaskID, len(pickupPath), len(deliveryPath))
	}

	log.Println("[TaskWorker] Global batch processing complete")
}
