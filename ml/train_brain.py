import mysql.connector
import json
import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
import time
import os
import threading
from datetime import datetime
from fastapi import FastAPI, Body
import uvicorn
from dotenv import load_dotenv

# Load database configuration from backend/.env
dotenv_path = os.path.join(os.path.dirname(__file__), '..', 'backend', '.env')
load_dotenv(dotenv_path)

# Database Configuration
DB_CONFIG = {
    'user': os.getenv('MYSQL_USER', 'root'),
    'password': os.getenv('MYSQL_PASSWORD', '1548'),
    'host': os.getenv('MYSQL_HOST', 'localhost'),
    'database': os.getenv('MYSQL_DATABASE', 'zyndor'),
    'port': int(os.getenv('MYSQL_PORT', 3306))
}

# Hyperparameters
LEARNING_RATE = 0.001
MODEL_PATH = 'ml/brain_policy.pth'
INPUT_DIM = 13
OUTPUT_DIM = 5

# Model Definition
class QNetwork(nn.Module):
    def __init__(self, input_dim, output_dim):
        super(QNetwork, self).__init__()
        self.fc1 = nn.Linear(input_dim, 64)
        self.fc2 = nn.Linear(64, 64)
        self.fc3 = nn.Linear(64, output_dim)

    def forward(self, x):
        x = torch.relu(self.fc1(x))
        x = torch.relu(self.fc2(x))
        return self.fc3(x)

# Initialize Model
model = QNetwork(INPUT_DIM, OUTPUT_DIM)
if os.path.exists(MODEL_PATH):
    try:
        model.load_state_dict(torch.load(MODEL_PATH))
        print("Loaded existing model.")
    except Exception as e:
        print(f"Failed to load model: {e}")
model.eval()

# FastAPI App
app = FastAPI()

@app.post("/predict")
async def predict(state: list[float] = Body(...)):
    if len(state) != INPUT_DIM:
        return {"error": f"Invalid state length. Expected {INPUT_DIM}, got {len(state)}", "action": 0}
    
    with torch.no_grad():
        state_t = torch.tensor([state], dtype=torch.float32)
        q_values = model(state_t)
        action = torch.argmax(q_values).item()
    
    return {"action": int(action), "q_values": q_values.tolist()[0]}

@app.get("/health")
async def health():
    return {"status": "ok", "last_training": str(datetime.now())}

def load_data(limit=10000):
    try:
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor(dictionary=True)
        query = "SELECT state, action, reward FROM experience_replay ORDER BY efficiency DESC, id DESC LIMIT %s"
        cursor.execute(query, (limit,))
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return rows
    except Exception as e:
        print(f"Error loading data: {e}")
        return []

def training_loop():
    global model
    while True:
        print(f"[{datetime.now()}] Starting training session...")
        data = load_data()
        if data:
            states, actions, rewards = [], [], []
            for row in data:
                try:
                    s = json.loads(row['state'])
                    if len(s) == INPUT_DIM:
                        states.append(s)
                        actions.append(row['action'])
                        rewards.append(row['reward'])
                except: continue

            if states:
                states_t = torch.tensor(states, dtype=torch.float32)
                actions_t = torch.tensor(actions, dtype=torch.int64).view(-1, 1)
                rewards_t = torch.tensor(rewards, dtype=torch.float32).view(-1, 1)

                model.train()
                optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
                criterion = nn.MSELoss()

                for _ in range(5):
                    optimizer.zero_grad()
                    outputs = model(states_t)
                    target_q = outputs.clone().detach()
                    for i in range(len(states)):
                        target_q[i, actions[i]] = rewards[i]
                    loss = criterion(outputs, target_q)
                    loss.backward()
                    optimizer.step()
                
                torch.save(model.state_dict(), MODEL_PATH)
                model.eval()
                print(f"Training complete. Loss: {loss.item():.4f}")
        
        time.sleep(300)

if __name__ == "__main__":
    # Start training in a background thread
    threading.Thread(target=training_loop, daemon=True).start()
    # Start FastAPI server
    uvicorn.run(app, host="0.0.0.0", port=8000)
