package main

import (
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

	_, err := DB.Exec("UPDATE tasks SET status = 'completed' WHERE task_id = ?", taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Wake up any tasks that were paused ("waiting") due to deadlocks,
	// because the grid structure has now changed and they might have a clear path.
	rows, err := DB.Query("SELECT task_id, get_x, get_y, put_x, put_y, priority, status, created_at FROM tasks WHERE status = 'waiting'")
	if err == nil {
		defer rows.Close()
		var waitingTasks []Task
		for rows.Next() {
			var t Task
			if err := rows.Scan(&t.TaskID, &t.GetX, &t.GetY, &t.PutX, &t.PutY, &t.Priority, &t.Status, &t.CreatedAt); err == nil {
				waitingTasks = append(waitingTasks, t)
			}
		}
		for _, t := range waitingTasks {
			log.Printf("[TaskWorker] Re-queueing waiting task %s after another task completed", t.TaskID)
			PushTask(t)
		}
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
	newTasks := DrainTasks()
	if len(newTasks) == 0 {
		return
	}

	log.Printf("[TaskWorker] Processing %d new task(s)...\n", len(newTasks))

	// Also load existing in_progress tasks from DB so deadlock detection
	// can catch conflicts between new tasks and already-running tasks.
	var existingTasks []Task
	rows, err := DB.Query("SELECT task_id, get_x, get_y, put_x, put_y, priority, status, created_at FROM tasks WHERE status = 'in_progress'")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var t Task
			if err := rows.Scan(&t.TaskID, &t.GetX, &t.GetY, &t.PutX, &t.PutY, &t.Priority, &t.Status, &t.CreatedAt); err == nil {
				existingTasks = append(existingTasks, t)
			}
		}
	}

	// Combine for deadlock detection
	allTasks := append(existingTasks, newTasks...)
	cycles := CheckDeadlock(allTasks)

	var resolution DeadlockResolution
	if len(cycles) > 0 {
		resolution = ResolveDeadlock(allTasks, cycles)
		log.Printf("[TaskWorker] Deadlock resolved, paused tasks: %v\n", resolution.PausedTaskIDs)

		// Only process the new tasks from the resolution (existing ones are already running)
		existingIDs := make(map[string]bool)
		for _, t := range existingTasks {
			existingIDs[t.TaskID] = true
		}

		var tasksToProcess []Task
		for _, t := range resolution.ReorderedTasks {
			if !existingIDs[t.TaskID] {
				tasksToProcess = append(tasksToProcess, t)
			} else if t.Status == "waiting" {
				// If an existing in_progress task is now in conflict, pause it
				DB.Exec("UPDATE tasks SET status = 'waiting' WHERE task_id = ?", t.TaskID)
				log.Printf("[TaskWorker] Existing task %s paused due to deadlock\n", t.TaskID)
			}
		}
		newTasks = tasksToProcess
	}

	InitReservations()

	// Re-reserve paths for existing in_progress tasks
	for _, t := range existingTasks {
		path, err := CooperativeAStar(t.GetX, t.GetY, t.PutX, t.PutY)
		if err == nil {
			Reservations.ReservePath(path)
		}
	}

	for _, task := range newTasks {
		if task.Status == "waiting" {
			log.Printf("[TaskWorker] Task %s paused due to deadlock resolution\n", task.TaskID)
			DB.Exec("UPDATE tasks SET status = 'waiting' WHERE task_id = ?", task.TaskID)
			PushTask(task)
			continue
		}

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

		Reservations.ReservePath(deliveryPath)

		DB.Exec("UPDATE tasks SET status = 'in_progress' WHERE task_id = ?", task.TaskID)

		log.Printf("[TaskWorker] Task %s: pickup path (%d steps), delivery path (%d steps)\n",
			task.TaskID, len(pickupPath), len(deliveryPath))
	}

	log.Println("[TaskWorker] Batch processing complete")
}
