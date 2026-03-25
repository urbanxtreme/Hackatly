package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

type RegisterRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
	Email    string `json:"email" binding:"required"`
}

type LoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func RegisterHandler(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	userID, token, err := CreateUser(req.Username, req.Password,req.Email)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Initialize default 30x30 map for new user
	defaultMap := make([][]int, 30)
	for i := range defaultMap {
		defaultMap[i] = make([]int, 30)
	}
	SaveUserMap(userID, defaultMap)
	InitMap(defaultMap)

	c.JSON(http.StatusOK, gin.H{
		"username": req.Username,
		"token":    token,
	})
}

func LoginHandler(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request payload"})
		return
	}

	userID, token, err := ValidateUser(req.Username, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid username or password"})
		return
	}

	// Load user map into memory on login
	if matrix, err := LoadUserMap(userID); err == nil {
		InitMap(matrix)
	}

	c.JSON(http.StatusOK, gin.H{
		"username": req.Username,
		"token":    token,
	})
}
