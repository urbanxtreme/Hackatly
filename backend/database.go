package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type Robot struct {
	ID               int64     `json:"id"`
	Name             string    `json:"name"`
	State            string    `json:"state"`    // active, idle, charging, error
	Priority         string    `json:"priority"` // high, medium, low
	CurrentPosition  []float64 `json:"current_position"`
	CurrentPositionX float64   `json:"x"`
	CurrentPositionY float64   `json:"y"`
	CurrentTask      string    `json:"current_task"`
	Battery          int       `json:"battery"`
}

type Log struct {
	ID        int64     `json:"id"`
	BotID     int64     `json:"bot_id"`
	Task      string    `json:"task"`
	Timestamp time.Time `json:"timestamp"`
}

type EfficiencyLog struct {
	ID        int64     `json:"id"`
	BotID     int64     `json:"bot_id"`
	Score     float64   `json:"score"`
	Timestamp time.Time `json:"timestamp"`
}

var DB *sql.DB

func getJWTKey() []byte {
	key := os.Getenv("JWT_SECRET")
	if key == "" {
		return []byte("default_secret_key_change_me")
	}
	return []byte(key)
}

func connector(mysqlUsername, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase string) (*sql.DB, error) {
	cfg := mysql.Config{
		User:                 mysqlUsername,
		Passwd:               mysqlPassword,
		Net:                  "tcp",
		Addr:                 fmt.Sprintf("%s:%s", mysqlHost, mysqlPort),
		DBName:               mysqlDatabase,
		AllowNativePasswords: true,
		ParseTime:            true,
	}
	return sql.Open("mysql", cfg.FormatDSN())
}

func ConnectDatabase() (*sql.DB, error) {
	mysqlHost := os.Getenv("MYSQL_HOST")
	mysqlPort := os.Getenv("MYSQL_PORT")
	mysqlUsername := os.Getenv("MYSQL_USER")
	mysqlPassword := os.Getenv("MYSQL_PASSWORD")
	mysqlDatabase := os.Getenv("MYSQL_DATABASE")

	var err error
	DB, err = connector(mysqlUsername, mysqlPassword, mysqlHost, mysqlPort, mysqlDatabase)
	if err != nil {
		return nil, fmt.Errorf("error connecting to database: %v", err)
	}

	err = DB.Ping()
	if err != nil {
		return nil, fmt.Errorf("database ping failed: %v", err)
	}

	return DB, nil
}

func DisconnectDatabase() error {
	if DB != nil {
		return DB.Close()
	}
	return nil
}

func CreateDatabase() error {
	err := CreateTable("users", `
	CREATE TABLE IF NOT EXISTS users (
		id INT AUTO_INCREMENT PRIMARY KEY,
		name VARCHAR(255) NOT NULL UNIQUE,
		password VARCHAR(255) NOT NULL,
		email VARCHAR(255) DEFAULT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("robots", `
	CREATE TABLE IF NOT EXISTS robots (
		id INT AUTO_INCREMENT PRIMARY KEY,
		name VARCHAR(255) NOT NULL,
		state VARCHAR(50) DEFAULT 'idle',
		priority VARCHAR(50) DEFAULT 'medium',
		current_position_x DOUBLE DEFAULT 0.0,
		current_position_y DOUBLE DEFAULT 0.0,
		current_task VARCHAR(255) DEFAULT 'none',
		battery INT DEFAULT 100
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("logs", `
	CREATE TABLE IF NOT EXISTS logs (
		id INT AUTO_INCREMENT PRIMARY KEY,
		bot_id INT NOT NULL,
		task VARCHAR(255),
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (bot_id) REFERENCES robots(id)
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("tasks", `
	CREATE TABLE IF NOT EXISTS tasks (
		task_id VARCHAR(255) PRIMARY KEY,
		get_x INT NOT NULL,
		get_y INT NOT NULL,
		put_x INT NOT NULL,
		put_y INT NOT NULL,
		priority VARCHAR(50) DEFAULT 'medium',
		status VARCHAR(50) DEFAULT 'pending',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("efficiency_history", `
	CREATE TABLE IF NOT EXISTS efficiency_history (
		id INT AUTO_INCREMENT PRIMARY KEY,
		bot_id INT NOT NULL,
		score DOUBLE NOT NULL,
		timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (bot_id) REFERENCES robots(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("map_metadata", `
	CREATE TABLE IF NOT EXISTS map_metadata (
		user_id INT NOT NULL PRIMARY KEY,
		rows INT NOT NULL,
		cols INT NOT NULL,
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return err
	}

	err = CreateTable("map_obstacles", `
	CREATE TABLE IF NOT EXISTS map_obstacles (
		user_id INT NOT NULL,
		x INT NOT NULL,
		y INT NOT NULL,
		PRIMARY KEY (user_id, x, y),
		FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
	)`)
	if err != nil {
		return err
	}

	return nil
}
func CreateTable(name string, query string) error {
	_, err := DB.Exec(query)
	if err != nil {
		return fmt.Errorf("failed to create %s table: %w", name, err)
	}
	log.Printf("Table %s checked/created successfully\n", name)
	return nil
}
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), 14)
	return string(bytes), err
}

func VerifyPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

func GenerateToken(userID int64) (string, error) {
	expirationTime := time.Now().Add(24 * time.Hour)
	claims := &jwt.RegisteredClaims{
		Subject:   fmt.Sprintf("%d", userID),
		ExpiresAt: jwt.NewNumericDate(expirationTime),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString(getJWTKey())
}

func VerifyToken(tokenString string) (*jwt.RegisteredClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{}, func(token *jwt.Token) (interface{}, error) {
		return getJWTKey(), nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*jwt.RegisteredClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, fmt.Errorf("invalid token")
}
func CreateUser(name, password, email string) (int64, string, error) {
	query := "INSERT INTO users (name, password,email) VALUES (?, ?, ?)"
	hashPassword, err := HashPassword(password)
	if err != nil {
		return 0, "", fmt.Errorf("failed to hash password: %w", err)
	}
	result, err := DB.Exec(query, name, hashPassword,email)
	if err != nil {
		return 0, "", fmt.Errorf("failed to insert user: %w", err)
	}

	lastID, err := result.LastInsertId()
	if err != nil {
		return 0, "", err
	}

	token, err := GenerateToken(lastID)
	return lastID, token, err
}

func ValidateUser(name, password string) (int64, string, error) {
	query := "SELECT id, password FROM users WHERE name = ?"

	var userid int64
	var dbPassword string

	err := DB.QueryRow(query, name).Scan(&userid, &dbPassword)
	if err != nil {
		return 0, "", err
	}

	if VerifyPassword(password, dbPassword) {
		token, err := GenerateToken(userid)
		return userid, token, err
	}

	return 0, "", fmt.Errorf("invalid password")
}

// Robot functions

func AddRobot(robot Robot) (int64, error) {
	query := `INSERT INTO robots (name, state, priority, current_position_x, current_position_y, current_task, battery) 
	          VALUES (?, ?, ?, ?, ?, ?, ?)`
	result, err := DB.Exec(query, robot.Name, robot.State, robot.Priority, robot.CurrentPositionX, robot.CurrentPositionY, robot.CurrentTask, robot.Battery)
	if err != nil {
		return 0, err
	}
	return result.LastInsertId()
}

func UpdateRobotState(id int64, state string) error {
	query := "UPDATE robots SET state = ? WHERE id = ?"
	_, err := DB.Exec(query, state, id)
	return err
}

func UpdateRobotPriority(id int64, priority string) error {
	query := "UPDATE robots SET priority = ? WHERE id = ?"
	_, err := DB.Exec(query, priority, id)
	return err
}

func UpdateRobotPosition(id int64, x, y float64) error {
	query := "UPDATE robots SET current_position_x = ?, current_position_y = ? WHERE id = ?"
	_, err := DB.Exec(query, x, y, id)
	return err
}

func UpdateRobotTask(id int64, taskID string) error {
	query := "UPDATE robots SET current_task = ? WHERE id = ?"
	_, err := DB.Exec(query, taskID, id)
	return err
}


func GetRobotByID(id int64) (Robot, error) {
	var r Robot
	query := "SELECT id, name, state, priority, current_position_x, current_position_y, current_task, battery FROM robots WHERE id = ?"
	err := DB.QueryRow(query, id).Scan(&r.ID, &r.Name, &r.State, &r.Priority, &r.CurrentPositionX, &r.CurrentPositionY, &r.CurrentTask, &r.Battery)
	if err == nil {
		r.CurrentPosition = []float64{r.CurrentPositionX, r.CurrentPositionY}
	}
	return r, err
}

func GetAllRobots() ([]Robot, error) {
	query := "SELECT id, name, state, priority, current_position_x, current_position_y, current_task, battery FROM robots"
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var robots []Robot
	for rows.Next() {
		var r Robot
		if err := rows.Scan(&r.ID, &r.Name, &r.State, &r.Priority, &r.CurrentPositionX, &r.CurrentPositionY, &r.CurrentTask, &r.Battery); err != nil {
			return nil, err
		}
		r.CurrentPosition = []float64{r.CurrentPositionX, r.CurrentPositionY}
		robots = append(robots, r)
	}
	return robots, nil
}

func DeleteRobot(id int64) error {
	// First delete associated logs due to foreign key constraint
	_, err := DB.Exec("DELETE FROM logs WHERE bot_id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete logs for robot: %w", err)
	}

	_, err = DB.Exec("DELETE FROM robots WHERE id = ?", id)
	if err != nil {
		return fmt.Errorf("failed to delete robot: %w", err)
	}
	return nil
}

func DeleteTask(taskID string) error {
	_, err := DB.Exec("DELETE FROM tasks WHERE task_id = ?", taskID)
	if err != nil {
		return fmt.Errorf("failed to delete task: %w", err)
	}
	RemoveTaskByID(taskID)
	return nil
}

// Log functions

func AddLog(botID int64, task string) error {
	query := "INSERT INTO logs (bot_id, task) VALUES (?, ?)"
	_, err := DB.Exec(query, botID, task)
	return err
}

func GetLogs() ([]Log, error) {
	query := "SELECT id, bot_id, task, timestamp FROM logs ORDER BY timestamp DESC"
	rows, err := DB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []Log
	for rows.Next() {
		var l Log
		if err := rows.Scan(&l.ID, &l.BotID, &l.Task, &l.Timestamp); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

func InsertEfficiency(botID int64, score float64) error {
	query := `INSERT INTO efficiency_history (bot_id, score) VALUES (?, ?)`
	_, err := DB.Exec(query, botID, score)
	return err
}

func GetEfficiencyHistory(botID int64) ([]EfficiencyLog, error) {
	query := `SELECT id, bot_id, score, timestamp FROM efficiency_history WHERE bot_id = ? ORDER BY timestamp ASC`
	rows, err := DB.Query(query, botID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var logs []EfficiencyLog
	for rows.Next() {
		var l EfficiencyLog
		if err := rows.Scan(&l.ID, &l.BotID, &l.Score, &l.Timestamp); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

// Map persistence functions

func SaveUserMap(userID int64, matrix [][]int) error {
	rows := len(matrix)
	cols := 0
	if rows > 0 {
		cols = len(matrix[0])
	}

	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Delete old metadata and obstacles
	_, _ = tx.Exec("DELETE FROM map_metadata WHERE user_id = ?", userID)
	_, _ = tx.Exec("DELETE FROM map_obstacles WHERE user_id = ?", userID)

	// 2. Insert metadata
	_, err = tx.Exec("INSERT INTO map_metadata (user_id, rows, cols) VALUES (?, ?, ?)", userID, rows, cols)
	if err != nil {
		return err
	}

	// 3. Insert obstacles (efficiency: only save 1s)
	stmt, err := tx.Prepare("INSERT INTO map_obstacles (user_id, x, y) VALUES (?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for x := 0; x < rows; x++ {
		for y := 0; y < cols; y++ {
			if matrix[x][y] == 1 {
				_, err = stmt.Exec(userID, x, y)
				if err != nil {
					return err
				}
			}
		}
	}

	return tx.Commit()
}

func SaveUserObstacles(userID int64, obstacles [][]int) error {
	tx, err := DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 1. Delete old obstacles (but keep metadata - dimensions stay the same)
	_, _ = tx.Exec("DELETE FROM map_obstacles WHERE user_id = ?", userID)

	// 2. Insert new obstacles
	stmt, err := tx.Prepare("INSERT INTO map_obstacles (user_id, x, y) VALUES (?, ?, ?)")
	if err != nil {
		return err
	}
	defer stmt.Close()

	for _, p := range obstacles {
		if len(p) == 2 {
			_, err = stmt.Exec(userID, p[0], p[1])
			if err != nil {
				return err
			}
		}
	}

	return tx.Commit()
}

func LoadUserMap(userID int64) ([][]int, error) {
	var rows, cols int
	err := DB.QueryRow("SELECT rows, cols FROM map_metadata WHERE user_id = ?", userID).Scan(&rows, &cols)
	if err != nil {
		return nil, err
	}

	// Initialize empty matrix
	matrix := make([][]int, rows)
	for i := range matrix {
		matrix[i] = make([]int, cols)
	}

	// Load obstacles
	obsRows, err := DB.Query("SELECT x, y FROM map_obstacles WHERE user_id = ?", userID)
	if err != nil {
		return nil, err
	}
	defer obsRows.Close()

	for obsRows.Next() {
		var x, y int
		if err := obsRows.Scan(&x, &y); err == nil {
			if x >= 0 && x < rows && y >= 0 && y < cols {
				matrix[x][y] = 1
			}
		}
	}

	return matrix, nil
}
