from django.urls import path, include
from . import views

urlpatterns = [
    path('', views.portal, name='portal'),
    path('parent/', views.parent, name='parent'),
    path('schooladmin/', views.schooladmin, name='schooladmin'),
    path('superadmin/', views.superadmin, name='superadmin'),
    path('fee-structure-manager/', views.fee_structure_manager, name='fee_structure_manager'),
    path('api/schools/', views.api_schools, name='api_schools'),    
    path('api/schools/create/', views.api_school_create, name='api_school_create'),
    path('api/mpesa/stk-push/', views.api_mpesa_stk_push, name='api_mpesa_stk_push'),
    path('api/mpesa/callback/', views.api_mpesa_callback, name='api_mpesa_callback'),
]
