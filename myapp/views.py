from django.shortcuts import render

def portal(request):
    return render(request, 'portal.html')

def parent(request):
    return render(request, 'parent.html')

def schooladmin(request):
    return render(request, 'schooladmin.html')

def superadmin(request):
    return render(request, 'superadmin.html')

def fee_structure_manager(request):
    return render(request, 'fee-structure-manager.html')