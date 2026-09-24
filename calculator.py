#!/usr/bin/env python3
"""Simple Python calculator that performs basic arithmetic operations."""

import sys


def add(x, y):
    return x + y


def subtract(x, y):
    return x - y


def multiply(x, y):
    return x * y


def divide(x, y):
    if y == 0:
        return "Error: Division by zero!"
    return x / y


def main():
    if len(sys.argv) != 4:
        print("Usage: python calculator.py <number1> <operator> <number2>")
        print("Operators: +, -, *, /")
        return

    try:
        num1 = float(sys.argv[1])
        operator = sys.argv[2]
        num2 = float(sys.argv[3])
    except ValueError:
        print("Error: Invalid numbers provided.")
        return

    if operator == '+':
        result = add(num1, num2)
    elif operator == '-':
        result = subtract(num1, num2)
    elif operator == '*':
        result = multiply(num1, num2)
    elif operator == '/':
        result = divide(num1, num2)
    else:
        print("Error: Invalid operator. Use +, -, *, or /")
        return

    print(f"Result: {result}")


if __name__ == "__main__":
    main()