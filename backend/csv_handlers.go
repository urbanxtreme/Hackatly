package main

import (
	"bytes"
	"encoding/csv"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// stripBOM removes UTF-8 BOM if present (common when saving CSV from Excel)
func stripBOM(data []byte) []byte {
	if len(data) >= 3 && data[0] == 0xEF && data[1] == 0xBB && data[2] == 0xBF {
		return data[3:]
	}
	return data
}

// normalizeHeader maps common variations to canonical column names
func normalizeRobotHeader(h string) string {
	h = strings.TrimSpace(strings.ToLower(h))
	switch h {
	case "name", "unit", "robot", "robot_name", "robotname", "bot":
		return "name"
	case "state", "status":
		return "state"
	case "priority", "prio":
		return "priority"
	case "battery", "battery_pct", "bat", "charge":
		return "battery"
	default:
		return h
	}
}

func normalizeTaskHeader(h string) string {
	h = strings.TrimSpace(strings.ToLower(h))
	switch h {
	case "task_id", "taskid", "id", "task":
		return "task_id"
	case "get_x", "getx", "pick_x", "pickx", "from_x", "fromx":
		return "get_x"
	case "get_y", "gety", "pick_y", "picky", "from_y", "fromy":
		return "get_y"
	case "put_x", "putx", "drop_x", "dropx", "to_x", "tox":
		return "put_x"
	case "put_y", "puty", "drop_y", "dropy", "to_y", "toy":
		return "put_y"
	case "priority", "prio":
		return "priority"
	default:
		return h
	}
}

// POST /robots/upload
// Accepts multipart CSV with flexible columns.
// Minimum: just a column of robot names (header can be "name", "unit", "robot", etc.)
// Optional columns: state, priority, battery
func BulkUploadRobotsHandler(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided. Use form field 'file'."})
		return
	}
	defer file.Close()

	// Reject Excel files early
	if header != nil {
		fname := strings.ToLower(header.Filename)
		if strings.HasSuffix(fname, ".xlsx") || strings.HasSuffix(fname, ".xls") {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Excel files (.xlsx/.xls) are not supported. Please save your file as CSV (Comma Separated Values) format: File → Save As → CSV UTF-8.",
			})
			return
		}
	}

	// Read all bytes and strip BOM
	raw, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file: " + err.Error()})
		return
	}
	raw = stripBOM(raw)

	reader := csv.NewReader(bytes.NewReader(raw))
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true
	// Allow variable number of fields per row
	reader.FieldsPerRecord = -1

	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Failed to parse CSV. Make sure the file is saved as CSV format (not Excel .xlsx). Error: " + err.Error(),
		})
		return
	}

	if len(records) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have a header row and at least one data row."})
		return
	}

	// Build column map with normalized headers
	headerRow := records[0]
	colMap := make(map[string]int)
	for i, h := range headerRow {
		normalized := normalizeRobotHeader(h)
		colMap[normalized] = i
	}

	// If there's only 1 column, treat it as robot names regardless of header
	singleColumnMode := len(headerRow) == 1

	// Check for name column (unless single column mode)
	if !singleColumnMode {
		if _, ok := colMap["name"]; !ok {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": fmt.Sprintf("Could not find a name column. Found columns: %v. Accepted names: name, unit, robot, bot", headerRow),
			})
			return
		}
	}

	created := 0
	var errors []string

	for i, row := range records[1:] {
		rowNum := i + 2

		// Get robot name
		var name string
		if singleColumnMode {
			if len(row) > 0 {
				name = strings.TrimSpace(row[0])
			}
		} else if idx, ok := colMap["name"]; ok && idx < len(row) {
			name = strings.TrimSpace(row[idx])
		}

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

		// Optional columns
		if idx, ok := colMap["state"]; ok && idx < len(row) {
			val := strings.TrimSpace(row[idx])
			if val != "" {
				robot.State = strings.ToLower(val)
			}
		}
		if idx, ok := colMap["priority"]; ok && idx < len(row) {
			val := strings.TrimSpace(row[idx])
			if val != "" {
				robot.Priority = strings.ToLower(val)
			}
		}
		if idx, ok := colMap["battery"]; ok && idx < len(row) {
			val := strings.TrimSpace(row[idx])
			if val != "" {
				b, err := strconv.Atoi(val)
				if err == nil && b >= 0 && b <= 100 {
					robot.Battery = b
				}
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
// Accepts multipart CSV with columns: task_id, get_x, get_y, put_x, put_y, priority
func BulkUploadTasksHandler(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No file provided. Use form field 'file'."})
		return
	}
	defer file.Close()

	// Reject Excel files early
	if header != nil {
		fname := strings.ToLower(header.Filename)
		if strings.HasSuffix(fname, ".xlsx") || strings.HasSuffix(fname, ".xls") {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "Excel files (.xlsx/.xls) are not supported. Please save your file as CSV: File → Save As → CSV UTF-8.",
			})
			return
		}
	}

	raw, err := io.ReadAll(file)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Failed to read file: " + err.Error()})
		return
	}
	raw = stripBOM(raw)

	reader := csv.NewReader(bytes.NewReader(raw))
	reader.TrimLeadingSpace = true
	reader.LazyQuotes = true
	reader.FieldsPerRecord = -1

	records, err := reader.ReadAll()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "Failed to parse CSV. Make sure the file is saved as CSV format (not Excel .xlsx). Error: " + err.Error(),
		})
		return
	}

	if len(records) < 2 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "CSV must have a header row and at least one data row."})
		return
	}

	headerRow := records[0]
	colMap := make(map[string]int)
	for i, h := range headerRow {
		normalized := normalizeTaskHeader(h)
		colMap[normalized] = i
	}

	// Validate required columns
	required := []string{"task_id", "get_x", "get_y", "put_x", "put_y"}
	var missing []string
	for _, col := range required {
		if _, ok := colMap[col]; !ok {
			missing = append(missing, col)
		}
	}
	if len(missing) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("Missing required columns: %v. Found columns: %v", missing, headerRow),
		})
		return
	}

	created := 0
	var errors []string

	for i, row := range records[1:] {
		rowNum := i + 2

		taskID := ""
		if idx, ok := colMap["task_id"]; ok && idx < len(row) {
			taskID = strings.TrimSpace(row[idx])
		}
		if taskID == "" {
			// Auto-generate task ID
			taskID = fmt.Sprintf("T%d%d", time.Now().UnixMilli(), i)
		}

		getXStr, getYStr, putXStr, putYStr := "", "", "", ""
		if idx, ok := colMap["get_x"]; ok && idx < len(row) { getXStr = strings.TrimSpace(row[idx]) }
		if idx, ok := colMap["get_y"]; ok && idx < len(row) { getYStr = strings.TrimSpace(row[idx]) }
		if idx, ok := colMap["put_x"]; ok && idx < len(row) { putXStr = strings.TrimSpace(row[idx]) }
		if idx, ok := colMap["put_y"]; ok && idx < len(row) { putYStr = strings.TrimSpace(row[idx]) }

		getX, err1 := strconv.Atoi(getXStr)
		getY, err2 := strconv.Atoi(getYStr)
		putX, err3 := strconv.Atoi(putXStr)
		putY, err4 := strconv.Atoi(putYStr)

		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			errors = append(errors, fmt.Sprintf("Row %d (%s): invalid coordinate values", rowNum, taskID))
			continue
		}

		priority := "medium"
		if idx, ok := colMap["priority"]; ok && idx < len(row) {
			val := strings.TrimSpace(row[idx])
			if val != "" {
				priority = strings.ToLower(val)
			}
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

		AddTaskLog(task)
		PushTask(task)
		created++
	}

	c.JSON(http.StatusOK, gin.H{
		"created": created,
		"errors":  errors,
		"total":   len(records) - 1,
	})
}
