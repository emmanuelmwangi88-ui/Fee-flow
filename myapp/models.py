from django.db import models

class School(models.Model):
    name = models.CharField(max_length=255)
    location = models.CharField(max_length=255, blank=True)
    level = models.CharField(max_length=100, blank=True)  # e.g. "Primary", "Secondary"
    paybill = models.CharField(max_length=20, blank=True)
    admin_username = models.CharField(max_length=100, blank=True)
    admin_password = models.CharField(max_length=255, blank=True)  # hash this later, not yet
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Student(models.Model):
    school = models.ForeignKey(School, on_delete=models.CASCADE, related_name='students')
    full_name = models.CharField(max_length=255)
    admission_number = models.CharField(max_length=50)
    grade = models.CharField(max_length=50)  # e.g. "Grade 4", "Form 2"
    parent_phone = models.CharField(max_length=20)

    def __str__(self):
        return self.full_name


class FeePayment(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    mpesa_receipt = models.CharField(max_length=100, blank=True, null=True)
    phone_number = models.CharField(max_length=20)
    status = models.CharField(
        max_length=20,
        choices=[('pending', 'Pending'), ('completed', 'Completed'), ('failed', 'Failed')],
        default='pending'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.student.full_name} - {self.amount}"