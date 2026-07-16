from django.urls import path, include
from . import views

urlpatterns = [
    path('', views.portal, name='portal'),
    path('parent/', views.parent, name='parent'),
    path('schooladmin/', views.schooladmin, name='schooladmin'),
    path('superadmin/', views.superadmin, name='superadmin'),
    path('fee-structure/', views.fee_structure_manager, name='fee_structure_manager'),
]