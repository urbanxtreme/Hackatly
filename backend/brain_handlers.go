package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"github.com/gin-gonic/gin"
)

type PredictRequest struct {
	State []float64 `json:"state"`
}

type PredictResponse struct {
	Action  int       `json:"action"`
	QValues []float64 `json:"q_values"`
}

func BrainPredictHandler(c *gin.Context) {
	var req PredictRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid state data"})
		return
	}

	// Proxy to Python ML Service
	jsonData, err := json.Marshal(req)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to marshal request"})
		return
	}

	resp, err := http.Post("http://localhost:8000/predict", "application/json", bytes.NewBuffer(jsonData))
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "ML Service offline", "action": 0})
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	var predictResp PredictResponse
	if err := json.Unmarshal(body, &predictResp); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse ML response", "action": 0})
		return
	}

	c.JSON(http.StatusOK, predictResp)
}
