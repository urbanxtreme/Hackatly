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

	result, err := DB.Exec("UPDATE tasks SET status = 'completed' WHERE task_id = ?", taskID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Task not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "task completed", "task_id": taskID})
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
	tasks := DrainTasks()
	if len(tasks) == 0 {
		return
	}

	log.Printf("[TaskWorker] Processing %d task(s)...\n", len(tasks))

	cycles := CheckDeadlock(tasks)

	var resolution DeadlockResolution
	if len(cycles) > 0 {
		resolution = ResolveDeadlock(tasks, cycles)
		tasks = resolution.ReorderedTasks
		log.Printf("[TaskWorker] Deadlock resolved, paused tasks: %v\n", resolution.PausedTaskIDs)
	} else {
		resolution = DeadlockResolution{
			ReorderedTasks: tasks,
			Message:        "no deadlock detected",
		}
	}

	InitReservations()

	for _, task := range tasks {
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
