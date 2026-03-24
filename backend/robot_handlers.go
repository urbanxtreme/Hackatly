package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

// POST /robots
func AddRobotHandler(c *gin.Context) {
	var robot Robot
	if err := c.ShouldBindJSON(&robot); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	// Set defaults
	if robot.State == "" {
		robot.State = "idle"
	}
	if robot.Priority == "" {
		robot.Priority = "medium"
	}
	if robot.Battery == 0 {
		robot.Battery = 100
	}
	if robot.CurrentTask == "" {
		robot.CurrentTask = "none"
	}

	id, err := AddRobot(robot)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	robot.ID = id
	c.JSON(http.StatusCreated, robot)
}

// PATCH /robots/:id/state
func UpdateRobotStateHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	var req struct {
		State string `json:"state" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := UpdateRobotState(id, req.State); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Log the state change as a task potentially
	AddLog(id, "State updated to: "+req.State)

	c.JSON(http.StatusOK, gin.H{"message": "Robot state updated successfully"})
}

// PATCH /robots/:id/priority
func UpdateRobotPriorityHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	var req struct {
		Priority string `json:"priority" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := UpdateRobotPriority(id, req.Priority); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	AddLog(id, "Priority updated to: "+req.Priority)

	c.JSON(http.StatusOK, gin.H{"message": "Robot priority updated successfully"})
}

// GET /robots/:id
func GetRobotByIDHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	robot, err := GetRobotByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Robot not found"})
		return
	}

	c.JSON(http.StatusOK, robot)
}

// GET /robots
func GetAllRobotsHandler(c *gin.Context) {
	robots, err := GetAllRobots()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, robots)
}

// GET /logs
func GetLogsHandler(c *gin.Context) {
	logs, err := GetLogs()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}

// POST /logs (Optional direct add)
func AddLogHandler(c *gin.Context) {
	var req struct {
		BotID int64  `json:"bot_id" binding:"required"`
		Task  string `json:"task" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := AddLog(req.BotID, req.Task); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Log entry added successfully"})
}
