package main

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
)

func AddRobotHandler(c *gin.Context) {
	var robot Robot
	if err := c.ShouldBindJSON(&robot); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

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

	AddLog(id, "State updated to: "+req.State)

	c.JSON(http.StatusOK, gin.H{"message": "Robot state updated successfully"})
}

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

func UpdateRobotPositionHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	var req struct {
		X float64 `json:"x"`
		Y float64 `json:"y"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := UpdateRobotPosition(id, req.X, req.Y); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Robot position updated successfully"})
}

func UpdateRobotTaskHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	var req struct {
		TaskID string `json:"task_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := UpdateRobotTask(id, req.TaskID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Robot task updated successfully"})
}


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

func GetAllRobotsHandler(c *gin.Context) {
	robots, err := GetAllRobots()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, robots)
}

func GetLogsHandler(c *gin.Context) {
	logs, err := GetLogs()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, logs)
}

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

func DeleteRobotHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	if err := DeleteRobot(id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Robot and associated logs deleted successfully"})
}

func AddEfficiencyHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	var req struct {
		Efficiency float64 `json:"efficiency" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := InsertEfficiency(id, req.Efficiency); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Efficiency logged successfully"})
}

func GetEfficiencyHandler(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseInt(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid robot ID"})
		return
	}

	history, err := GetEfficiencyHistory(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, history)
}
