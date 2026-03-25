package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func UpdateAnalyticsHandler(c *gin.Context) {
	var req Analytics
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	if err := UpdateAnalytics(req); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Analytics updated successfully"})
}

func GetAnalyticsSummaryHandler(c *gin.Context) {
	analytics, err := GetAnalytics()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch analytics"})
		return
	}

	robots, err := GetAllRobots()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch robots"})
		return
	}

	type RobotEfficiency struct {
		ID         int64   `json:"id"`
		Name       string  `json:"name"`
		Efficiency float64 `json:"efficiency"`
	}

	var robotsEfficiency []RobotEfficiency
	for _, r := range robots {
		robotsEfficiency = append(robotsEfficiency, RobotEfficiency{
			ID:         r.ID,
			Name:       r.Name,
			Efficiency: r.Efficiency,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"analytics":        analytics,
		"robots_efficiency": robotsEfficiency,
	})
}
