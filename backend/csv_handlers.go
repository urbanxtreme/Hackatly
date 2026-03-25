package main

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// POST /robots/upload
// Expects multipart form with a "file" field containing a CSV.
// CSV columns: name, state, priority, battery
func BulkUploadRobotsHandler(c *gin.Context) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided. Use form field 'file'."})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse CSV: " + err.Error()})
		return
	}

	if len(records) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have a header row and at least one data row"})
		return
	}

	// Parse header to find column indices
	header := records[0]
	colMap := make(map[string]int)
	for i, h := range header {
		colMap[strings.TrimSpace(strings.ToLower(h))] = i
	}

	// Validate required column
	if _, ok := colMap["name"]; !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have a 'name' column"})
		return
	}

	created := 0
	var errors []string

	for i, row := range records[1:] {
		rowNum := i + 2 // 1-indexed, skip header

		name := strings.TrimSpace(row[colMap["name"]])
		if name == "" {
			errors = append(errors, fmt.Sprintf("Row %d: empty name, skipped", rowNum))
			continue
		}

		robot := Robot{
			Name:        name,
			State:       "idle",
			Priority:    "medium",
			Battery:     100,
			CurrentTask: "none",
		}

		if idx, ok := colMap["state"]; ok && idx < len(row) && strings.TrimSpace(row[idx]) != "" {
			robot.State = strings.TrimSpace(row[idx])
		}
		if idx, ok := colMap["priority"]; ok && idx < len(row) && strings.TrimSpace(row[idx]) != "" {
			robot.Priority = strings.TrimSpace(row[idx])
		}
		if idx, ok := colMap["battery"]; ok && idx < len(row) && strings.TrimSpace(row[idx]) != "" {
			b, err := strconv.Atoi(strings.TrimSpace(row[idx]))
			if err == nil {
				robot.Battery = b
			}
		}

		_, err := AddRobot(robot)
		if err != nil {
			errors = append(errors, fmt.Sprintf("Row %d (%s): %v", rowNum, name, err))
			continue
		}
		created++
	}

	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"errors":  errors,
		"total":   len(records) - 1,
	})
}

// POST /tasks/upload
// Expects multipart form with a "file" field containing a CSV.
// CSV columns: task_id, get_x, get_y, put_x, put_y, priority
func BulkUploadTasksHandler(c *gin.Context) {
	file, _, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided. Use form field 'file'."})
		return
	}
	defer file.Close()

	reader := csv.NewReader(file)
	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to parse CSV: " + err.Error()})
		return
	}

	if len(records) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have a header row and at least one data row"})
		return
	}

	header := records[0]
	colMap := make(map[string]int)
	for i, h := range header {
		colMap[strings.TrimSpace(strings.ToLower(h))] = i
	}

	// Validate required columns
	required := []string{"task_id", "get_x", "get_y", "put_x", "put_y"}
	for _, col := range required {
		if _, ok := colMap[col]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("CSV must have a '%s' column", col)})
			return
		}
	}

	created := 0
	var errors []string

	for i, row := range records[1:] {
		rowNum := i + 2

		taskID := strings.TrimSpace(row[colMap["task_id"]])
		if taskID == "" {
			errors = append(errors, fmt.Sprintf("Row %d: empty task_id, skipped", rowNum))
			continue
		}

		getX, err1 := strconv.Atoi(strings.TrimSpace(row[colMap["get_x"]]))
		getY, err2 := strconv.Atoi(strings.TrimSpace(row[colMap["get_y"]]))
		putX, err3 := strconv.Atoi(strings.TrimSpace(row[colMap["put_x"]]))
		putY, err4 := strconv.Atoi(strings.TrimSpace(row[colMap["put_y"]]))

		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			errors = append(errors, fmt.Sprintf("Row %d (%s): invalid coordinate values", rowNum, taskID))
			continue
		}

		priority := "medium"
		if idx, ok := colMap["priority"]; ok && idx < len(row) && strings.TrimSpace(row[idx]) != "" {
			priority = strings.TrimSpace(row[idx])
		}

		task := Task{
			TaskID:    taskID,
			GetX:      getX,
			GetY:      getY,
			PutX:      putX,
			PutY:      putY,
			Priority:  priority,
			Status:    "pending",
			CreatedAt: time.Now(),
		}

		_, dbErr := DB.Exec(
			"INSERT INTO tasks (task_id, get_x, get_y, put_x, put_y, priority, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
			task.TaskID, task.GetX, task.GetY, task.PutX, task.PutY, task.Priority, task.Status,
		)
		if dbErr != nil {
			errors = append(errors, fmt.Sprintf("Row %d (%s): %v", rowNum, taskID, dbErr))
			continue
		}

		PushTask(task)
		created++
	}

	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"errors":  errors,
		"total":   len(records) - 1,
	})
}
